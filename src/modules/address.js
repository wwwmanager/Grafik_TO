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

// Detect region from records by majority vote against regions.json
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
        counts.set(reg.code, (counts.get(reg.code) || 0) + 1);
        break;
      }
    }
  }
  if (!counts.size) return null;
  let bestCode = null, bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) { bestCount = count; bestCode = code; }
  }
  return bestCode;
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

// Settlement cache
const settlementCache = new Map();

export async function loadSettlements(codes) {
  const results = [];
  for (const code of codes) {
    if (settlementCache.has(code)) {
      results.push(...settlementCache.get(code));
      continue;
    }
    try {
      const url = `${import.meta.env.BASE_URL}data/settlements/${code}.json`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      settlementCache.set(code, data);
      results.push(...data);
    } catch (e) {
      console.warn(`Failed to load settlements for region ${code}:`, e);
    }
  }
  return results;
}

// Build lookup map from settlements data
function buildLookupMap(settlements) {
  const map = new Map();
  for (const s of settlements) {
    const normName = normalizeName(s.name);
    const normMuni = normalizeName(s.municipality);
    const key = `${normName}|${normMuni}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return map;
}

// Resolve a parsed address to a settlement reference
export function resolveSettlement(parsed, settlements) {
  const lookup = buildLookupMap(settlements);
  
  // Try exact match at finest level first
  const candidates = [];
  
  // Inner settlement match
  if (parsed.inner) {
    const normInner = normalizeName(parsed.inner);
    const normCity = normalizeName(parsed.city);
    const normDistrict = normalizeName(parsed.district);
    
    for (const [key, list] of lookup) {
      const [name, muni] = key.split('|');
      if (name === normInner) {
        // Prefer matching municipality (district/city)
        if (normDistrict && muni === normDistrict) {
          return { ...list[0], match: 'exact', key: `${name}|${muni}` };
        }
        if (normCity && muni === normCity) {
          return { ...list[0], match: 'exact', key: `${name}|${muni}` };
        }
        candidates.push(...list.map(s => ({ ...s, match: 'exact', key })));
      }
    }
  }
  
  // City/village match
  if (parsed.city) {
    const normCity = normalizeName(parsed.city);
    const normDistrict = normalizeName(parsed.district);
    
    for (const [key, list] of lookup) {
      const [name, muni] = key.split('|');
      if (name === normCity) {
        if (normDistrict && muni === normDistrict) {
          return { ...list[0], match: 'exact', key: `${name}|${muni}` };
        }
        candidates.push(...list.map(s => ({ ...s, match: 'exact', key })));
      }
    }
  }
  
  // District match (only for urban okrugs without city, or when no city/inner specified)
  if (parsed.district && !parsed.city && !parsed.inner) {
    const normDistrict = normalizeName(parsed.district);
    for (const [key, list] of lookup) {
      const [, muni] = key.split('|');
      if (muni === normDistrict) {
        candidates.push(...list.map(s => ({ ...s, match: 'exact', key })));
      }
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
    
    for (const [key, list] of lookup) {
      const [name] = key.split('|');
      const dist = levenshtein(normSearch, name);
      if (dist <= 2) {
        matchCount++;
        if (dist < bestDist) {
          bestDist = dist;
          bestMatch = list[0];
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
  return REGIONS_TABLE.map(r => ({ code: r.code, name: r.name, iso: r.iso }));
}

export function getDefaultRegionSettings(detectedCode) {
  return {
    inspectionRegion: detectedCode || null,
    neighboringRegions: [],
    hint: detectedCode ? null : 'Выберите регион инспекции'
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