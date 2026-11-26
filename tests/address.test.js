import { describe, expect, it } from 'vitest';
import {
  parseAddress,
  normalizeName,
  buildGroupKey,
  detectRegion,
  resolveSettlement,
  getRegionsForSelect,
  getDefaultRegionSettings,
  REGIONS_TABLE
} from '../src/modules/address.js';

// Mock settlements data for testing - matches TEST_ADDRESSES
const MOCK_SETTLEMENTS = [
  // Zlatoust urban okrug (no district in reality, but test uses КУСИНСКИЙ Р-Н)
  { name: 'Златоуст', type: 'city', municipality: 'Кусинский', lat: 55.17, lon: 59.67 },
  { name: 'Тайнак', type: 'village', municipality: 'Кусинский', lat: 55.2, lon: 59.7 },
  { name: 'Тундуш', type: 'village', municipality: 'Кусинский', lat: 55.22, lon: 59.72 },
  { name: 'Магнитка', type: 'village', municipality: 'Кусинский', lat: 55.3, lon: 59.8 },
  { name: 'Тюбук', type: 'village', municipality: 'Каслинский', lat: 55.4, lon: 59.9 },
  { name: 'Бердяуш', type: 'village', municipality: 'Саткинский', lat: 55.5, lon: 60.0 },
  { name: 'Сатка', type: 'town', municipality: 'Саткинский', lat: 55.6, lon: 60.1 },
  { name: 'Кусино', type: 'village', municipality: 'Кусинский', lat: 55.7, lon: 60.2 },
  { name: 'Касли', type: 'town', municipality: 'Каслинский', lat: 55.8, lon: 60.3 },
  { name: 'Трёхгорный', type: 'city', municipality: 'Трёхгорный городской округ', lat: 55.9, lon: 60.4 },
  { name: 'Кизылское', type: 'village', municipality: 'Кизильский', lat: 56.0, lon: 60.5 },
  { name: 'Усть-Катав', type: 'town', municipality: 'Усть-Катавский', lat: 56.1, lon: 60.6 },
  { name: 'Миасс', type: 'city', municipality: 'Миассский', lat: 56.2, lon: 60.7 },
  { name: 'Челябинск', type: 'city', municipality: 'Челябинск городской округ', lat: 55.16, lon: 61.4 },
  { name: 'Коркино', type: 'town', municipality: 'Коркинский', lat: 54.9, lon: 61.3 },
  { name: 'Еманжелинск', type: 'town', municipality: 'Еманжелинский', lat: 54.8, lon: 61.2 },
  { name: 'Копейск', type: 'city', municipality: 'Копейск городской округ', lat: 55.1, lon: 61.5 },
  { name: 'Озерск', type: 'city', municipality: 'Озерск городской округ', lat: 55.7, lon: 60.7 },
  { name: 'Снежинск', type: 'city', municipality: 'Снежинск городской округ', lat: 56.0, lon: 60.7 },
  { name: 'Троицк', type: 'city', municipality: 'Троицкий', lat: 54.1, lon: 61.5 },
  { name: 'Южноуральск', type: 'city', municipality: 'Южноуральск городской округ', lat: 54.4, lon: 61.2 },
  { name: 'Карталы', type: 'town', municipality: 'Карталинский', lat: 53.1, lon: 60.6 },
  { name: 'Пласт', type: 'town', municipality: 'Пластовский', lat: 54.3, lon: 60.8 },
  { name: 'Аша', type: 'town', municipality: 'Ашинский', lat: 55.0, lon: 57.3 },
  { name: 'Миньяр', type: 'town', municipality: 'Ашинский', lat: 55.1, lon: 57.5 },
  // Duplicate names across municipalities
  { name: 'Сосновка', type: 'village', municipality: 'Кизильский', lat: 53.5, lon: 58.1 },
  { name: 'Сосновка', type: 'village', municipality: 'Варненский', lat: 53.6, lon: 58.2 },
  { name: 'Новый', type: 'village', municipality: 'Куринский', lat: 53.7, lon: 58.3 },
  { name: 'Новый', type: 'village', municipality: 'Чесминский', lat: 53.8, lon: 58.4 },
];

// Test addresses - FICTIONAL (real settlement names allowed, streets/houses/persons invented)
const TEST_ADDRESSES = [
  // Standard addresses with all levels
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , КУСИНСКИЙ Р-Н, ЗЛАТОУСТ Г, , , ТАЙНАК П', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КУСИНСКИЙ Р-Н', city: 'ЗЛАТОУСТ Г', inner: 'ТАЙНАК П' }, desc: 'Full address with inner settlement' },
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , КУСИНСКИЙ Р-Н, МАГНИТКА РП, , , ', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КУСИНСКИЙ Р-Н', city: 'МАГНИТКА РП', inner: '' }, desc: 'Address with RP type' },
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , КАСЛИНСКИЙ Р-Н, ТЮБУК С, , , ', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КАСЛИНСКИЙ Р-Н', city: 'ТЮБУК С', inner: '' }, desc: 'Address with S type' },
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , САТКИНСКИЙ Р-Н, БЕРДЯУШ С, , , ', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'САТКИНСКИЙ Р-Н', city: 'БЕРДЯУШ С', inner: '' }, desc: 'Address with village' },
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , , САТКА Г, , , ', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: '', city: 'САТКА Г', inner: '' }, desc: 'Urban okrug (no district)' },
  
  // Spelling variants
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛАСТЬ, , , КУСИНСКИЙ РАЙОН, Г. ЗЛАТОУСТ, , , П. ТАЙНАК', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛАСТЬ', district: 'КУСИНСКИЙ РАЙОН', city: 'Г. ЗЛАТОУСТ', inner: 'П. ТАЙНАК' }, desc: 'Full spelling variants' },
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , КУСИНСКИЙ Р-Н, ЗЛАТОУСТ, , , ТАЙНАК', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КУСИНСКИЙ Р-Н', city: 'ЗЛАТОУСТ', inner: 'ТАЙНАК' }, desc: 'Without type suffixes' },
  { addr: 'челябинская обл, , , кусинский р-н, златоуст г, , , тайнак п', expect: { region: 'челябинская обл', district: 'кусинский р-н', city: 'златоуст г', inner: 'тайнак п' }, desc: 'Lowercase' },
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , КУСИНСКИЙ Р-Н, ЗЛАТОУСТ Г, , , ТАЙНАК П, УЛ. ЛЕНИНА, Д. 1', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КУСИНСКИЙ Р-Н', city: 'ЗЛАТОУСТ Г', inner: 'ТАЙНАК П' }, desc: 'Extra parts ignored' },
  
  // Missing levels
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , КИЗИЛЬСКИЙ Р-Н, , , , ', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КИЗИЛЬСКИЙ Р-Н', city: '', inner: '' }, desc: 'District only, no city' },
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , , ТРЁХГОРНЫЙ Г, , , ', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: '', city: 'ТРЁХГОРНЫЙ Г', inner: '' }, desc: 'City without district (urban okrug)' },
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , , УСТЬ-КАТАВ Г, , , ', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: '', city: 'УСТЬ-КАТАВ Г', inner: '' }, desc: 'City with hyphen' },
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , , МИАСС Г, , , ', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: '', city: 'МИАСС Г', inner: '' }, desc: 'Simple city' },
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , , ЧЕЛЯБИНСК Г, , , ', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: '', city: 'ЧЕЛЯБИНСК Г', inner: '' }, desc: 'Regional center' },
  
  // Duplicate names across districts
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , КИЗИЛЬСКИЙ Р-Н, СОСНОВКА С, , , ', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КИЗИЛЬСКИЙ Р-Н', city: 'СОСНОВКА С', inner: '' }, desc: 'Sosnovka in Kizilsky' },
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , ВАРНЕНСКИЙ Р-Н, СОСНОВКА С, , , ', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'ВАРНЕНСКИЙ Р-Н', city: 'СОСНОВКА С', inner: '' }, desc: 'Sosnovka in Varnensky' },
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , КУРИНСКИЙ Р-Н, НОВЫЙ С, , , ', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КУРИНСКИЙ Р-Н', city: 'НОВЫЙ С', inner: '' }, desc: 'Novy in Kurinsky' },
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , ЧЕСМИНСКИЙ Р-Н, НОВЫЙ С, , , ', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'ЧЕСМИНСКИЙ Р-Н', city: 'НОВЫЙ С', inner: '' }, desc: 'Novy in Chesmensky' },
  
  // Neighbour region address
  { addr: 'СВЕРДЛОВСКАЯ ОБЛ, , , , ЕКАТЕРИНБУРГ Г, , , ', expect: { region: 'СВЕРДЛОВСКАЯ ОБЛ', district: '', city: 'ЕКАТЕРИНБУРГ Г', inner: '' }, desc: 'Neighbour region' },
  { addr: 'РЕСПУБЛИКА БАШКОРТОСТАН, , , , УФА Г, , , ', expect: { region: 'РЕСПУБЛИКА БАШКОРТОСТАН', district: '', city: 'УФА Г', inner: '' }, desc: 'Republic' },
  { addr: 'КУРГАНСКАЯ ОБЛ, , , , КУРГАН Г, , , ', expect: { region: 'КУРГАНСКАЯ ОБЛ', district: '', city: 'КУРГАН Г', inner: '' }, desc: 'Kurgan region' },
  
  // Edge cases
  { addr: '', expect: { region: '', district: '', city: '', inner: '' }, desc: 'Empty address' },
  { addr: 'ЧЕЛЯБИНСКАЯ ОБЛ', expect: { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: '', city: '', inner: '' }, desc: 'Only region' },
  { addr: ', , , , ЗЛАТОУСТ Г, , , ', expect: { region: '', district: '', city: 'ЗЛАТОУСТ Г', inner: '' }, desc: 'Only city' },
];

describe('address resolver (GRAFIK-33)', () => {
  describe('parseAddress', () => {
    for (const tc of TEST_ADDRESSES) {
      it(`parses: ${tc.desc}`, () => {
        const result = parseAddress(tc.addr);
        expect(result.region).toBe(tc.expect.region);
        expect(result.district).toBe(tc.expect.district);
        expect(result.city).toBe(tc.expect.city);
        expect(result.inner).toBe(tc.expect.inner);
      });
    }
  });

  describe('normalizeName', () => {
    it('strips type tokens from prefix and suffix', () => {
      expect(normalizeName('Г. ЗЛАТОУСТ')).toBe('златоуст');
      expect(normalizeName('ЗЛАТОУСТ Г')).toBe('златоуст');
      expect(normalizeName('П. ТАЙНАК')).toBe('тайнак');
      expect(normalizeName('ТАЙНАК П')).toBe('тайнак');
      expect(normalizeName('С. МАГНИТКА')).toBe('магнитка');
      expect(normalizeName('МАГНИТКА С')).toBe('магнитка');
      expect(normalizeName('РП МАГНИТКА')).toBe('магнитка');
      expect(normalizeName('МАГНИТКА РП')).toBe('магнитка');
      expect(normalizeName('Р-Н КУСИНСКИЙ')).toBe('кусинский');
      expect(normalizeName('КУСИНСКИЙ Р-Н')).toBe('кусинский');
      expect(normalizeName('КАСЛИНСКИЙ РАЙОН')).toBe('каслинский');
    });

    it('handles ё -> е', () => {
      expect(normalizeName('ТРЁХГОРНЫЙ')).toBe('трехгорный');
      expect(normalizeName('ЁЖ')).toBe('еж');
    });

    it('collapses spaces and hyphens', () => {
      expect(normalizeName('ЗЛАТОУСТ   Г')).toBe('златоуст');
      expect(normalizeName('УСТЬ - КАТАВ')).toBe('усть-катав');
    });
  });

  describe('buildGroupKey', () => {
    it('finest level first, parent = district else city', () => {
      const parsed = { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КУСИНСКИЙ Р-Н', city: 'ЗЛАТОУСТ Г', inner: 'ТАЙНАК П' };
      const { key, parent } = buildGroupKey(parsed);
      expect(key).toBe('тайнак|златоуст|кусинский|челябинская обл');
      expect(parent).toBe('кусинский');
    });

    it('urban okrug: parent = city when no district', () => {
      const parsed = { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: '', city: 'ЧЕЛЯБИНСК Г', inner: '' };
      const { key, parent } = buildGroupKey(parsed);
      expect(key).toBe('челябинск|челябинская обл');
      expect(parent).toBe('челябинск');
    });

    it('district only: parent = district', () => {
      const parsed = { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КИЗИЛЬСКИЙ Р-Н', city: '', inner: '' };
      const { key, parent } = buildGroupKey(parsed);
      expect(key).toBe('кизильский|челябинская обл');
      expect(parent).toBe('кизильский');
    });
  });

  describe('detectRegion', () => {
    it('returns majority regionCode', () => {
      const records = [
        { address: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , КУСИНСКИЙ Р-Н, ЗЛАТОУСТ Г, , , ' },
        { address: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , КАСЛИНСКИЙ Р-Н, ТЮБУК С, , , ' },
        { address: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , САТКИНСКИЙ Р-Н, БЕРДЯУШ С, , , ' },
        { address: 'СВЕРДЛОВСКАЯ ОБЛ, , , , ЕКАТЕРИНБУРГ Г, , , ' },
      ];
      const regionCode = detectRegion(records, REGIONS_TABLE);
      expect(regionCode).toBe(74); // Челябинская область regionCode
    });

    it('returns null when no region part', () => {
      const records = [
        { address: ', , , КУСИНСКИЙ Р-Н, ЗЛАТОУСТ Г, , , ' },
        { address: ', , , КАСЛИНСКИЙ Р-Н, ТЮБУК С, , , ' },
      ];
      const code = detectRegion(records, REGIONS_TABLE);
      expect(code).toBeNull();
    });

    it('returns null for empty records', () => {
      expect(detectRegion([], REGIONS_TABLE)).toBeNull();
      expect(detectRegion(null, REGIONS_TABLE)).toBeNull();
    });
  });

  describe('resolveSettlement', () => {
    it('exact match with inner settlement', () => {
      const parsed = { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КУСИНСКИЙ Р-Н', city: 'ЗЛАТОУСТ Г', inner: 'ТАЙНАК П' };
      const result = resolveSettlement(parsed, MOCK_SETTLEMENTS);
      expect(result.match).toBe('exact');
      expect(result.name).toBe('Тайнак');
      expect(result.municipality).toBe('Кусинский');
    });

    it('exact match city without inner', () => {
      const parsed = { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КУСИНСКИЙ Р-Н', city: 'ЗЛАТОУСТ Г', inner: '' };
      const result = resolveSettlement(parsed, MOCK_SETTLEMENTS);
      expect(result.match).toBe('exact');
      expect(result.name).toBe('Златоуст');
      expect(result.municipality).toBe('Кусинский');
    });

    it('exact match RP type', () => {
      const parsed = { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КУСИНСКИЙ Р-Н', city: 'МАГНИТКА РП', inner: '' };
      const result = resolveSettlement(parsed, MOCK_SETTLEMENTS);
      expect(result.match).toBe('exact');
      expect(result.name).toBe('Магнитка');
      expect(result.municipality).toBe('Кусинский');
    });

    it('exact match village type', () => {
      const parsed = { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КАСЛИНСКИЙ Р-Н', city: 'ТЮБУК С', inner: '' };
      const result = resolveSettlement(parsed, MOCK_SETTLEMENTS);
      expect(result.match).toBe('exact');
      expect(result.name).toBe('Тюбук');
      expect(result.municipality).toBe('Каслинский');
    });

    it('urban okrug without district', () => {
      const parsed = { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: '', city: 'ЧЕЛЯБИНСК Г', inner: '' };
      const result = resolveSettlement(parsed, MOCK_SETTLEMENTS);
      expect(result.match).toBe('exact');
      expect(result.name).toBe('Челябинск');
      expect(result.municipality).toBe('Челябинск городской округ');
    });

    it('disambiguates duplicate names by municipality', () => {
      const parsed1 = { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КИЗИЛЬСКИЙ Р-Н', city: 'СОСНОВКА С', inner: '' };
      const result1 = resolveSettlement(parsed1, MOCK_SETTLEMENTS);
      expect(result1.match).toBe('exact');
      expect(result1.municipality).toBe('Кизильский');

      const parsed2 = { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'ВАРНЕНСКИЙ Р-Н', city: 'СОСНОВКА С', inner: '' };
      const result2 = resolveSettlement(parsed2, MOCK_SETTLEMENTS);
      expect(result2.match).toBe('exact');
      expect(result2.municipality).toBe('Варненский');
    });

    it('marks ambiguous when same name in same municipality', () => {
      // Both "Новый" in different municipalities but parsed without district
      const parsed = { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: '', city: 'НОВЫЙ С', inner: '' };
      const result = resolveSettlement(parsed, MOCK_SETTLEMENTS);
      expect(result.match).toBe('ambiguous');
      expect(result.candidates).toBeDefined();
      expect(result.candidates.length).toBeGreaterThan(1);
    });

    it('fuzzy match (Levenshtein <= 2) when unique', () => {
      const parsed = { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КУСИНСКИЙ Р-Н', city: 'ЗЛАТОУСТТ Г', inner: '' }; // typo
      const result = resolveSettlement(parsed, MOCK_SETTLEMENTS);
      expect(result.match).toBe('fuzzy');
      expect(result.name).toBe('Златоуст');
    });

    it('no fuzzy match when not unique', () => {
      // Add another similar name to make fuzzy non-unique
      const settlements = [...MOCK_SETTLEMENTS, { name: 'Златоуска', type: 'village', municipality: 'Другой', lat: 0, lon: 0 }];
      const parsed = { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'КУСИНСКИЙ Р-Н', city: 'ЗЛАТОУСТТ Г', inner: '' };
      const result = resolveSettlement(parsed, settlements);
      // Should not be fuzzy because ambiguous
      expect(result.match).not.toBe('fuzzy');
    });

    it('returns text key when no match', () => {
      const parsed = { region: 'ЧЕЛЯБИНСКАЯ ОБЛ', district: 'НЕИЗВЕСТНЫЙ Р-Н', city: 'НЕИЗВЕСТНЫЙ Г', inner: '' };
      const result = resolveSettlement(parsed, MOCK_SETTLEMENTS);
      expect(result.match).toBe('none');
      expect(result.key).toContain('НЕИЗВЕСТНЫЙ');
    });
  });

  describe('region settings', () => {
    it('getRegionsForSelect returns all regions', () => {
      const regions = getRegionsForSelect();
      expect(regions.length).toBe(REGIONS_TABLE.length);
      expect(regions[0]).toHaveProperty('dataId');
      expect(regions[0]).toHaveProperty('regionCode');
      expect(regions[0]).toHaveProperty('name');
      expect(regions[0]).toHaveProperty('iso');
    });

    it('getDefaultRegionSettings returns detected region', () => {
      const settings = getDefaultRegionSettings(72);
      expect(settings.inspectionRegion).toBe(72);
      expect(settings.neighboringRegions).toEqual([]);
      expect(settings.hint).toBeNull();
    });

    it('getDefaultRegionSettings returns hint when no detected', () => {
      const settings = getDefaultRegionSettings(null);
      expect(settings.inspectionRegion).toBeNull();
      expect(settings.hint).toBe('Выберите регион инспекции');
    });
  });
});

// Print match rate summary
describe('match rate summary', () => {
  it('prints exact/fuzzy/none/ambiguous rates', () => {
    let exact = 0, fuzzy = 0, none = 0, ambiguous = 0;
    for (const tc of TEST_ADDRESSES) {
      const parsed = parseAddress(tc.addr);
      const result = resolveSettlement(parsed, MOCK_SETTLEMENTS);
      if (result.match === 'exact') exact++;
      else if (result.match === 'fuzzy') fuzzy++;
      else if (result.match === 'ambiguous') ambiguous++;
      else none++;
    }
    const total = TEST_ADDRESSES.length;
    console.log(`Match rate: exact=${exact}/${total} (${Math.round(exact/total*100)}%), fuzzy=${fuzzy}/${total} (${Math.round(fuzzy/total*100)}%), ambiguous=${ambiguous}/${total} (${Math.round(ambiguous/total*100)}%), none=${none}/${total} (${Math.round(none/total*100)}%)`);
    expect(exact + fuzzy + ambiguous + none).toBe(total);
  });
});