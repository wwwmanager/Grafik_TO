#!/usr/bin/env node
// Build-time script to fetch settlements from OSM Overpass API using area membership
// For each admin_level=4 region, fetch its admin_level=6 municipalities, then fetch place nodes
// Output: public/data/settlements/<code>.json per region
// Run: node scripts/build-settlements.mjs [--region <code>] [--all] [--force]

import https from 'https';
import fs from 'fs';
import path from 'path';

const OVERPASS_URL = 'https://overpass.openstreetmap.fr/api/interpreter';
const OUT_DIR = path.resolve('public/data/settlements');
const REGIONS_FILE = path.resolve('public/data/regions.json');
const MAX_FILE_SIZE = 1.5 * 1024 * 1024; // 1.5 MB raw

// OFFICIAL STABLE TABLE: code -> { iso, name, osm_name, bbox }
// Source: OKATO/OKTMO subject codes + ISO 3166-2:RU
// Codes are FIXED and must not be reassigned across rebuilds.
// 74 = Челябинская область (must be preserved per D23)
const REGIONS = [
  // Classic 83 subjects + 2 federal cities (85 total)
  { code: 1,  iso: 'RU-AD',  name: 'Республика Адыгея',           osm_name: 'Адыгея',                      bbox: [43.9, 38.5, 45.2, 40.8] },
  { code: 2,  iso: 'RU-AL',  name: 'Республика Алтай',           osm_name: 'Алтай',                       bbox: [49.2, 84.5, 51.0, 89.5] },
  { code: 3,  iso: 'RU-ALT', name: 'Алтайский край',             osm_name: 'Алтайский край',              bbox: [50.5, 78.5, 54.5, 87.0] },
  { code: 4,  iso: 'RU-AMU', name: 'Амурская область',           osm_name: 'Амурская область',            bbox: [48.5, 119.0, 56.5, 135.0] },
  { code: 5,  iso: 'RU-ARK', name: 'Архангельская область',      osm_name: 'Архангельская область',       bbox: [60.5, 36.0, 66.5, 55.0] },
  { code: 6,  iso: 'RU-AST', name: 'Астраханская область',       osm_name: 'Астраханская область',        bbox: [45.5, 44.5, 48.5, 50.0] },
  { code: 7,  iso: 'RU-BA',  name: 'Республика Башкортостан',    osm_name: 'Башкортостан',                bbox: [51.5, 52.0, 56.5, 61.0] },
  { code: 8,  iso: 'RU-BEL', name: 'Белгородская область',       osm_name: 'Белгородская область',        bbox: [49.5, 35.0, 51.5, 40.0] },
  { code: 9,  iso: 'RU-BRY', name: 'Брянская область',           osm_name: 'Брянская область',            bbox: [51.5, 30.5, 54.0, 35.5] },
  { code: 10, iso: 'RU-BU',  name: 'Республика Бурятия',        osm_name: 'Бурятия',                     bbox: [49.5, 102.0, 56.0, 114.0] },
  { code: 11, iso: 'RU-CE',  name: 'Чеченская Республика',       osm_name: 'Чечня',                       bbox: [42.0, 43.5, 44.5, 47.5] },
  { code: 74, iso: 'RU-CHE', name: 'Челябинская область',        osm_name: 'Челябинская область',         bbox: [51.9, 57.0, 56.4, 63.4] },
  { code: 13, iso: 'RU-CU',  name: 'Чувашская Республика',       osm_name: 'Чувашия',                     bbox: [54.0, 45.0, 56.5, 49.0] },
  { code: 14, iso: 'RU-DA',  name: 'Республика Дагестан',       osm_name: 'Дагестан',                    bbox: [41.0, 44.5, 45.0, 51.0] },
  { code: 15, iso: 'RU-IN',  name: 'Республика Ингушетия',      osm_name: 'Ингушетия',                   bbox: [42.5, 44.0, 43.5, 45.5] },
  { code: 16, iso: 'RU-IRK', name: 'Иркутская область',          osm_name: 'Иркутская область',           bbox: [50.0, 99.0, 61.0, 120.0] },
  { code: 17, iso: 'RU-IVA', name: 'Ивановская область',         osm_name: 'Ивановская область',          bbox: [55.5, 39.5, 58.0, 44.5] },
  { code: 18, iso: 'RU-KAM', name: 'Камчатский край',            osm_name: 'Камчатский край',             bbox: [50.5, 155.0, 66.0, 172.0] },
  { code: 19, iso: 'RU-KB',  name: 'Кабардино-Балкарская Республика', osm_name: 'Кабардино-Балкария',     bbox: [42.5, 41.5, 44.5, 45.0] },
  { code: 20, iso: 'RU-KC',  name: 'Карачаево-Черкесская Республика', osm_name: 'Карачаево-Черкесия',     bbox: [42.5, 40.5, 45.0, 44.0] },
  { code: 21, iso: 'RU-KDA', name: 'Краснодарский край',         osm_name: 'Краснодарский край',          bbox: [43.5, 36.0, 47.5, 41.5] },
  { code: 22, iso: 'RU-KEM', name: 'Кемеровская область',        osm_name: 'Кемеровская область',         bbox: [52.0, 82.0, 56.5, 90.0] },
  { code: 23, iso: 'RU-KGD', name: 'Калининградская область',    osm_name: 'Калининградская область',     bbox: [54.0, 19.5, 55.5, 23.0] },
  { code: 24, iso: 'RU-KGN', name: 'Курганская область',         osm_name: 'Курганская область',          bbox: [53.5, 61.0, 56.5, 68.0] },
  { code: 25, iso: 'RU-KHA', name: 'Хабаровский край',           osm_name: 'Хабаровский край',            bbox: [45.0, 128.0, 54.0, 148.0] },
  { code: 26, iso: 'RU-KHM', name: 'Ханты-Мансийский АО — Югра', osm_name: 'Ханты-Мансийский автономный округ — Югра', bbox: [58.0, 58.0, 65.0, 88.0] },
  { code: 27, iso: 'RU-KIR', name: 'Кировская область',          osm_name: 'Кировская область',           bbox: [56.0, 45.0, 61.0, 55.0] },
  { code: 28, iso: 'RU-KK',  name: 'Республика Хакасия',        osm_name: 'Хакасия',                     bbox: [51.0, 86.0, 55.5, 95.0] },
  { code: 29, iso: 'RU-KL',  name: 'Республика Калмыкия',       osm_name: 'Калмыкия',                    bbox: [45.0, 42.0, 47.5, 48.0] },
  { code: 30, iso: 'RU-KO',  name: 'Республика Коми',           osm_name: 'Коми',                        bbox: [61.0, 45.0, 68.0, 60.0] },
  { code: 31, iso: 'RU-KOS', name: 'Костромская область',        osm_name: 'Костромская область',         bbox: [56.5, 40.0, 59.5, 48.0] },
  { code: 32, iso: 'RU-KR',  name: 'Республика Карелия',        osm_name: 'Карелия',                     bbox: [60.0, 29.0, 67.0, 38.0] },
  { code: 33, iso: 'RU-KRS', name: 'Курская область',            osm_name: 'Курская область',             bbox: [50.5, 34.0, 52.5, 38.5] },
  { code: 34, iso: 'RU-KYA', name: 'Красноярский край',          osm_name: 'Красноярский край',           bbox: [51.0, 85.0, 77.0, 115.0] },
  { code: 35, iso: 'RU-LEN', name: 'Ленинградская область',      osm_name: 'Ленинградская область',       bbox: [58.0, 27.0, 61.0, 35.0] },
  { code: 36, iso: 'RU-LIP', name: 'Липецкая область',           osm_name: 'Липецкая область',            bbox: [51.5, 36.0, 53.5, 41.5] },
  { code: 37, iso: 'RU-MAG', name: 'Магаданская область',        osm_name: 'Магаданская область',         bbox: [58.5, 145.0, 66.0, 162.0] },
  { code: 38, iso: 'RU-ME',  name: 'Республика Марий Эл',       osm_name: 'Марий Эл',                    bbox: [55.0, 45.5, 58.0, 50.0] },
  { code: 39, iso: 'RU-MO',  name: 'Московская область',         osm_name: 'Московская область',          bbox: [54.0, 34.5, 57.0, 40.5] },
  { code: 40, iso: 'RU-MOW', name: 'Москва',                     osm_name: 'Москва',                      bbox: [55.1, 36.5, 56.1, 38.5] },
  { code: 41, iso: 'RU-MUR', name: 'Мурманская область',         osm_name: 'Мурманская область',          bbox: [66.0, 28.0, 70.0, 43.0] },
  { code: 42, iso: 'RU-NEN', name: 'Ненецкий АО',                osm_name: 'Ненецкий автономный округ',     bbox: [66.0, 42.0, 70.0, 62.0] },
  { code: 43, iso: 'RU-NGR', name: 'Новгородская область',       osm_name: 'Новгородская область',        bbox: [56.5, 29.0, 60.0, 36.0] },
  { code: 44, iso: 'RU-NIZ', name: 'Нижегородская область',      osm_name: 'Нижегородская область',       bbox: [54.0, 41.0, 57.5, 48.0] },
  { code: 45, iso: 'RU-NVS', name: 'Новосибирская область',      osm_name: 'Новосибирская область',       bbox: [53.0, 76.0, 56.5, 84.0] },
  { code: 46, iso: 'RU-OMS', name: 'Омская область',             osm_name: 'Омская область',              bbox: [53.0, 70.0, 57.0, 78.0] },
  { code: 47, iso: 'RU-ORE', name: 'Оренбургская область',       osm_name: 'Оренбургская область',        bbox: [49.0, 47.0, 54.5, 62.0] },
  { code: 48, iso: 'RU-ORL', name: 'Орловская область',          osm_name: 'Орловская область',           bbox: [51.5, 34.0, 54.0, 39.0] },
  { code: 49, iso: 'RU-PER', name: 'Пермский край',              osm_name: 'Пермский край',               bbox: [56.0, 50.0, 62.0, 60.0] },
  { code: 50, iso: 'RU-PNZ', name: 'Пензенская область',         osm_name: 'Пензенская область',          bbox: [51.5, 41.5, 55.0, 47.5] },
  { code: 51, iso: 'RU-PRI', name: 'Приморский край',            osm_name: 'Приморский край',             bbox: [42.0, 130.0, 48.5, 139.0] },
  { code: 52, iso: 'RU-PSK', name: 'Псковская область',          osm_name: 'Псковская область',           bbox: [54.5, 27.0, 58.5, 34.0] },
  { code: 53, iso: 'RU-ROS', name: 'Ростовская область',         osm_name: 'Ростовская область',          bbox: [45.5, 38.0, 50.5, 45.0] },
  { code: 54, iso: 'RU-RYA', name: 'Рязанская область',          osm_name: 'Рязанская область',           bbox: [53.0, 38.0, 56.0, 43.5] },
  { code: 55, iso: 'RU-SA',  name: 'Республика Саха (Якутия)',  osm_name: 'Саха (Якутия)',              bbox: [55.0, 105.0, 76.0, 170.0] },
  { code: 56, iso: 'RU-SAK', name: 'Сахалинская область',        osm_name: 'Сахалинская область',         bbox: [46.0, 141.0, 55.0, 157.0] },
  { code: 57, iso: 'RU-SAM', name: 'Самарская область',          osm_name: 'Самарская область',           bbox: [52.0, 47.0, 55.5, 53.0] },
  { code: 58, iso: 'RU-SAR', name: 'Саратовская область',        osm_name: 'Саратовская область',         bbox: [50.0, 43.0, 54.5, 51.0] },
  { code: 59, iso: 'RU-SE',  name: 'Республика Северная Осетия — Алания', osm_name: 'Северная Осетия — Алания', bbox: [42.0, 42.0, 44.5, 46.5] },
  { code: 60, iso: 'RU-SMO', name: 'Смоленская область',         osm_name: 'Смоленская область',          bbox: [53.5, 30.0, 56.5, 36.0] },
  { code: 61, iso: 'RU-SPE', name: 'Санкт-Петербург',            osm_name: 'Санкт-Петербург',             bbox: [59.5, 29.0, 60.5, 31.0] },
  { code: 62, iso: 'RU-STA', name: 'Ставропольский край',        osm_name: 'Ставропольский край',         bbox: [43.0, 40.0, 47.0, 46.0] },
  { code: 63, iso: 'RU-SVE', name: 'Свердловская область',       osm_name: 'Свердловская область',        bbox: [55.5, 56.0, 61.0, 67.0] },
  { code: 64, iso: 'RU-TA',  name: 'Республика Татарстан',      osm_name: 'Татарстан',                   bbox: [54.0, 47.0, 56.5, 55.0] },
  { code: 65, iso: 'RU-TAM', name: 'Тамбовская область',         osm_name: 'Тамбовская область',          bbox: [51.0, 39.0, 54.5, 44.5] },
  { code: 66, iso: 'RU-TOM', name: 'Томская область',            osm_name: 'Томская область',             bbox: [54.0, 76.0, 61.0, 88.0] },
  { code: 67, iso: 'RU-TUL', name: 'Тульская область',           osm_name: 'Тульская область',            bbox: [52.5, 35.0, 55.5, 40.0] },
  { code: 68, iso: 'RU-TVE', name: 'Тверская область',           osm_name: 'Тверская область',            bbox: [55.0, 30.5, 58.5, 37.0] },
  { code: 69, iso: 'RU-TY',  name: 'Республика Тыва',           osm_name: 'Тыва',                       bbox: [49.5, 88.0, 53.5, 99.0] },
  { code: 70, iso: 'RU-TYU', name: 'Тюменская область',          osm_name: 'Тюменская область',           bbox: [55.0, 61.0, 60.0, 85.0] },
  { code: 71, iso: 'RU-UD',  name: 'Удмуртская Республика',      osm_name: 'Удмуртия',                    bbox: [55.0, 49.0, 58.5, 57.0] },
  { code: 72, iso: 'RU-ULY', name: 'Ульяновская область',        osm_name: 'Ульяновская область',         bbox: [52.5, 45.0, 55.5, 51.5] },
  { code: 73, iso: 'RU-VLA', name: 'Владимирская область',       osm_name: 'Владимирская область',        bbox: [54.5, 38.5, 57.0, 43.0] },
  { code: 95, iso: 'RU-VGG', name: 'Волгоградская область',     osm_name: 'Волгоградская область',      bbox: [47.5, 41.0, 51.0, 48.0] },
  { code: 75, iso: 'RU-VLG', name: 'Вологодская область',       osm_name: 'Вологодская область',         bbox: [58.0, 35.0, 62.0, 44.0] },
  { code: 76, iso: 'RU-VOR', name: 'Воронежская область',       osm_name: 'Воронежская область',         bbox: [49.0, 37.0, 53.0, 43.0] },
  { code: 12, iso: 'RU-YEV', name: 'Еврейская АО',              osm_name: 'Еврейская автономная область',  bbox: [47.5, 130.0, 50.0, 136.0] },
  { code: 77, iso: 'RU-YAR', name: 'Ярославская область',        osm_name: 'Ярославская область',           bbox: [56.5, 36.5, 59.5, 42.0] },
  { code: 78, iso: 'RU-ZAB', name: 'Забайкальский край',        osm_name: 'Забайкальский край',          bbox: [48.0, 106.0, 57.0, 122.0] },
  { code: 79, iso: 'RU-KLU', name: 'Калужская область',          osm_name: 'Калужская область',           bbox: [52.5, 33.5, 55.5, 38.5] },
  { code: 80, iso: 'RU-CR',  name: 'Республика Крым',           osm_name: 'Крым',                        bbox: [44.0, 32.0, 46.5, 37.0] },
  { code: 81, iso: 'RU-SEV', name: 'Севастополь',                osm_name: 'Севастополь',                 bbox: [44.0, 33.0, 45.0, 34.5] },
  { code: 82, iso: 'RU-MOR', name: 'Республика Мордовия',       osm_name: 'Мордовия',                    bbox: [53.0, 41.5, 55.5, 47.0] },
  { code: 83, iso: 'RU-CHU', name: 'Чукотский АО',              osm_name: 'Чукотский автономный округ',    bbox: [61.0, 162.0, 72.0, 180.0] },
  { code: 84, iso: 'RU-YAN', name: 'Ямало-Ненецкий АО',          osm_name: 'Ямало-Ненецкий автономный округ', bbox: [62.0, 58.0, 71.0, 90.0] },
  // New territories (OSM coverage may be limited / disputed) — use name:ru tags for Russian names
  { code: 85, iso: 'RU-DON', name: 'Донецкая Народная Республика', osm_name: 'Донецкая Народная Республика', bbox: [46.5, 36.5, 49.5, 40.5] },
  { code: 86, iso: 'RU-LUG', name: 'Луганская Народная Республика', osm_name: 'Луганская Народная Республика', bbox: [47.0, 38.0, 50.0, 41.0] },
  { code: 87, iso: 'RU-ZAP', name: 'Запорожская область',       osm_name: 'Запорожская область',         bbox: [46.0, 34.0, 48.5, 38.0] },
  { code: 88, iso: 'RU-KHE', name: 'Херсонская область',        osm_name: 'Херсонская область',          bbox: [45.5, 32.5, 48.0, 36.5] },
];

// Validate uniqueness at load time
const codeCounts = {};
const isoCounts = {};
const nameCounts = {};
for (const r of REGIONS) {
  codeCounts[r.code] = (codeCounts[r.code] || 0) + 1;
  isoCounts[r.iso] = (isoCounts[r.iso] || 0) + 1;
  nameCounts[r.name] = (nameCounts[r.name] || 0) + 1;
}
for (const [code, count] of Object.entries(codeCounts)) {
  if (count > 1) console.error(`DUPLICATE CODE in REGIONS table: ${code} (${count} entries)`);
}
for (const [iso, count] of Object.entries(isoCounts)) {
  if (count > 1) console.error(`DUPLICATE ISO in REGIONS table: ${iso} (${count} entries)`);
}

// Parse CLI args
const args = process.argv.slice(2);
let targetRegion = null;
let runAll = false;
let force = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--region' && i + 1 < args.length) {
    targetRegion = args[++i];
  } else if (args[i] === '--all') {
    runAll = true;
  } else if (args[i] === '--force') {
    force = true;
  }
}

if (!runAll && !targetRegion) {
  console.log('Usage: node scripts/build-settlements.mjs [--region <code>] [--all] [--force]');
  console.log('  --region <code>  Build single region by official numeric code (e.g., 74)');
  console.log('  --all            Build all regions');
  console.log('  --force          Overwrite existing files');
  process.exit(1);
}

// Fetch from Overpass using POST with retry and backoff
async function fetchOverpass(query, retries = 3, baseDelay = 2000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fetchOverpassOnce(query);
      return result;
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      console.log(`  Attempt ${attempt + 1} failed: ${err.message}. Retrying in ${Math.round(delay)}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

function fetchOverpassOnce(query) {
  return new Promise((resolve, reject) => {
    const postData = `data=${encodeURIComponent(query)}`;
    const req = https.request(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'grafik-to/1.0 (build script)',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(180000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(postData);
    req.end();
  });
}

function cleanMunicipalityName(name) {
  let cleaned = name
    .replace(/\s+муниципальный\s+район$/i, '')
    .replace(/\s+городской\s+округ$/i, '')
    .replace(/\s+муниципальный$/i, '')
    .replace(/\s+район$/i, '')
    .replace(/\s+округ$/i, '')
    .trim();

  // Map adjective forms to noun forms for urban okrugs (common across Russia)
  const urbanOkrugMap = {
    'Челябинский': 'Челябинск',
    'Магнитогорский': 'Магнитогорск',
    'Златоустовский': 'Златоуст',
    'Миасский': 'Миасс',
    'Копейский': 'Копейск',
    'Коркинский': 'Коркино',
    'Южноуральский': 'Южноуральск',
    'Снежинский': 'Снежинск',
    'Озёрский': 'Озёрск',
    'Трёхгорный': 'Трехгорный',
    'Карабашский': 'Карабаш',
    'Кыштымский': 'Кыштым',
    'Усть-Катавский': 'Усть-Катав',
    'Ашинский': 'Аша',
    'Троицкий': 'Троицк',
    'Верхнеуральский': 'Верхнеуральск',
    'Верхнеуфалейский': 'Верхнеуфалейск',
    'Локомотивный': 'Локомотивный',
    'Чебаркульский': 'Чебаркуль',
    'Еманжелинский': 'Еманжелинск',
    'Трехгорный': 'Трехгорный',
    'Московский': 'Москва',
    'Санкт-Петербургский': 'Санкт-Петербург',
    'Новосибирский': 'Новосибирск',
    'Екатеринбургский': 'Екатеринбург',
    'Нижнегородский': 'Нижний Новгород',
    'Казанский': 'Казань',
    'Омский': 'Омск',
    'Самарский': 'Самара',
    'Ростовский': 'Ростов-на-Дону',
    'Уфимский': 'Уфа',
    'Красноярский': 'Красноярск',
    'Пермский': 'Пермь',
    'Воронежский': 'Воронеж',
    'Волгоградский': 'Волгоград',
    'Краснодарский': 'Краснодар',
    'Саратовский': 'Саратов',
    'Тюменский': 'Тюмень',
    'Тольяттинский': 'Тольятти',
    'Ижевский': 'Ижевск',
    'Барнаульский': 'Барнаул',
    'Ульяновский': 'Ульяновск',
    'Иркутский': 'Иркутск',
    'Хабаровский': 'Хабаровск',
    'Ярославский': 'Ярославль',
    'Владивостокский': 'Владивосток',
    'Махачкалинский': 'Махачкала',
    'Томский': 'Томск',
    'Оренбургский': 'Оренбург',
    'Кемеровский': 'Кемерово',
    'Новокузнецкий': 'Новокузнецк',
    'Рязанский': 'Рязань',
    'Астраханский': 'Астрахань',
    'Набережноднепровский': 'Набережные Челны',
    'Пензенский': 'Пенза',
    'Липецкий': 'Липецк',
    'Тульский': 'Тула',
    'Кировский': 'Киров',
    'Чебоксарский': 'Чебоксары',
    'Калининградский': 'Калининград',
    'Брянский': 'Брянск',
    'Курский': 'Курск',
    'Ивановский': 'Иваново',
    'Тверский': 'Тверь',
    'Ставропольский': 'Ставрополь',
    'Белгородский': 'Белгород',
    'Сочинский': 'Сочи',
    'Нижнетагильский': 'Нижний Тагил',
    'Архангельский': 'Архангельск',
    'Владимирский': 'Владимир',
    'Симферопольский': 'Симферополь',
    'Севастопольский': 'Севастополь',
    'Крымский': 'Крым',
    'Мордовский': 'Мордовия',
    'Чукотский': 'Чукотка',
    'Донецкий': 'Донецк',
    'Луганский': 'Луганск',
    'Запорожский': 'Запорожье',
    'Херсонский': 'Херсон',
    'Еврейский': 'Еврейская',
    'Забайкальский': 'Забайкальск',
    'Калужский': 'Калуга',
    'Ямало-Ненецкий': 'Ямало-Ненецкий',
  };

  cleaned = cleaned.replace(/\s+муниципальный$/i, '');

  return urbanOkrugMap[cleaned] || cleaned;
}

function isJunkName(name) {
  if (!name) return true;
  if (/^\d/.test(name)) return true;
  if (/^ур\.|урочище/i.test(name)) return true;
  if (/нежил/i.test(name)) return true;
  if (/загон|террикон|га\b/.test(name)) return true;
  return false;
}

function buildBoundaryQuery(region) {
  // Use ISO3166-2 as primary query (more reliable than name matching)
  return `
[out:json][timeout:180];
(
  relation["boundary"="administrative"]["admin_level"="4"]["ISO3166-2"="${region.iso}"];
  map_to_area -> .region;
  relation["boundary"="administrative"]["admin_level"="6"](area.region);
);
out body;
>;
out skel qt;
`;
}

async function fetchMunicipalities(boundaryQuery) {
  const boundaryData = await fetchOverpass(boundaryQuery);
  const boundaryElements = boundaryData.elements || [];

  const relations = boundaryElements.filter(e => e.type === 'relation');
  const municipalities = [];

  for (const rel of relations) {
    if (rel.tags?.boundary === 'administrative' && rel.tags?.admin_level === '6') {
      const rawName = rel.tags.name || rel.tags['name:ru'] || `municipality_${rel.id}`;
      const name = cleanMunicipalityName(rawName);
      municipalities.push({ id: rel.id, name, rawName });
    }
  }

  return municipalities;
}

async function fetchSettlementsForMunicipality(municipality, bbox, pauseMs = 2500) {
  const areaId = 3600000000 + municipality.id;
  const query = `
[out:json][timeout:120];
node["place"~"city|town|village|hamlet|locality"](area:${areaId});
out body;
`;

  const data = await fetchOverpass(query);
  const nodes = data.elements || [];

  const settlements = [];
  for (const node of nodes) {
    if (!node.tags?.place) continue;
    const name = node.tags.name || node.tags['name:ru'] || node.tags['official_name'] || '';
    if (!name) continue;

    const lat = node.lat;
    const lon = node.lon;

    if (lat < bbox[0] || lat > bbox[2] || lon < bbox[1] || lon > bbox[3]) continue;

    settlements.push({
      osmId: node.id,
      name,
      type: node.tags.place,
      municipality: municipality.name,
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5))
    });
  }

  if (pauseMs > 0) {
    await new Promise(r => setTimeout(r, pauseMs));
  }

  return settlements;
}

// Fetch settlements directly from admin_level=4 area (for federal cities: Moscow, Saint Petersburg, Sevastopol, Crimea)
async function fetchSettlementsFromRegionArea(region, pauseMs = 2500) {
  const query = `
[out:json][timeout:180];
(
  relation["boundary"="administrative"]["admin_level"="4"]["ISO3166-2"="${region.iso}"];
  map_to_area -> .region;
  node["place"~"city|town|village|hamlet|locality"](area.region);
);
out body;
`;

  const data = await fetchOverpass(query);
  const nodes = data.elements || [];

  const settlements = [];
  for (const node of nodes) {
    if (!node.tags?.place) continue;
    const name = node.tags.name || node.tags['name:ru'] || node.tags['official_name'] || '';
    if (!name) continue;

    const lat = node.lat;
    const lon = node.lon;

    if (lat < region.bbox[0] || lat > region.bbox[2] || lon < region.bbox[1] || lon > region.bbox[3]) continue;

    // For federal cities, the municipality is the region name itself
    settlements.push({
      osmId: node.id,
      name,
      type: node.tags.place,
      municipality: region.name,
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5))
    });
  }

  if (pauseMs > 0) {
    await new Promise(r => setTimeout(r, pauseMs));
  }

  return settlements;
}

function deduplicateSettlements(settlements) {
  let droppedById = 0;
  let droppedByCoords = 0;
  let droppedLocalities = 0;
  let droppedJunk = 0;
  const droppedJunkNames = [];

  const seenIds = new Set();
  const afterIdDedupe = [];
  for (const s of settlements) {
    if (seenIds.has(s.osmId)) {
      droppedById++;
    } else {
      seenIds.add(s.osmId);
      afterIdDedupe.push(s);
    }
  }

  const afterLocalityFilter = [];
  for (const s of afterIdDedupe) {
    if (s.type === 'locality') {
      droppedLocalities++;
    } else {
      afterLocalityFilter.push(s);
    }
  }

  const afterJunkFilter = [];
  for (const s of afterLocalityFilter) {
    if (isJunkName(s.name)) {
      droppedJunk++;
      droppedJunkNames.push(s.name + ' (' + s.municipality + ')');
    } else {
      afterJunkFilter.push(s);
    }
  }

  const seenCoords = new Map();
  const finalSettlements = [];
  for (const s of afterJunkFilter) {
    const key = s.name + '|' + s.municipality + '|' + s.lat.toFixed(3) + '|' + s.lon.toFixed(3);
    if (seenCoords.has(key)) {
      droppedByCoords++;
    } else {
      seenCoords.set(key, true);
      finalSettlements.push({
        name: s.name,
        type: s.type,
        municipality: s.municipality,
        lat: s.lat,
        lon: s.lon
      });
    }
  }

  return {
    settlements: finalSettlements,
    stats: {
      droppedById,
      droppedByCoords,
      droppedLocalities,
      droppedJunk,
      droppedJunkNames
    }
  };
}

async function buildRegion(region, forceOverwrite = false) {
  const outFile = path.join(OUT_DIR, `${region.code}.json`);
  if (fs.existsSync(outFile) && !forceOverwrite) {
    console.log(`  Skipping ${region.code} (${region.name}) — file exists, use --force to overwrite`);
    const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    return { success: true, skipped: true, code: region.code, count: existing.length, bytes: fs.statSync(outFile).size };
  }

  console.log(`\n=== Building region ${region.code}: ${region.name} (${region.iso}) ===`);
  const bbox = region.bbox;

  // Federal cities / regions with no admin_level=6: Moscow (40), Saint Petersburg (61), Sevastopol (81), Crimea (80)
  const isFederalCity = region.code === 40 || region.code === 61 || region.code === 80 || region.code === 81;

  try {
    let allSettlements = [];
    const unassigned = [];
    let municipalities = [];

    if (isFederalCity) {
      console.log(`  Federal city/region — fetching settlements directly from admin_level=4 area...`);
      allSettlements = await fetchSettlementsFromRegionArea(region);
      console.log(`    -> ${allSettlements.length} settlements`);
    } else {
      const boundaryQuery = buildBoundaryQuery(region);
      municipalities = await fetchMunicipalities(boundaryQuery);
      console.log(`  Found ${municipalities.length} municipalities (admin_level=6)`);

      if (municipalities.length === 0) {
        // Fallback: try ISO-based query
        console.log(`  Trying ISO-based fallback query...`);
        const isoQuery = `
[out:json][timeout:180];
(
  relation["boundary"="administrative"]["admin_level"="4"]["ISO3166-2"="${region.iso}"];
  map_to_area -> .region;
  relation["boundary"="administrative"]["admin_level"="6"](area.region);
);
out body;
>;
out skel qt;
`;
        const fallbackMunicipalities = await fetchMunicipalities(isoQuery);
        console.log(`  Fallback found ${fallbackMunicipalities.length} municipalities`);
        if (fallbackMunicipalities.length > 0) {
          municipalities.push(...fallbackMunicipalities);
        }
      }

      if (municipalities.length === 0) {
        throw new Error(`Zero municipalities found for ${region.name} (${region.iso}) — query failed`);
      }

      for (let i = 0; i < municipalities.length; i++) {
        const mun = municipalities[i];
        console.log(`  [${i + 1}/${municipalities.length}] ${mun.name} (rel ${mun.id})...`);
        try {
          const settlements = await fetchSettlementsForMunicipality(mun, bbox);
          allSettlements.push(...settlements);
          console.log(`    -> ${settlements.length} settlements`);
        } catch (err) {
          console.error(`    ERROR: ${err.message}`);
          unassigned.push({ municipality: mun.name, error: err.message });
        }
      }
    }

    console.log(`  Total settlements fetched (raw): ${allSettlements.length}`);
    console.log(`  Municipalities with errors: ${unassigned.length}`);

    if (allSettlements.length === 0) {
      throw new Error(`Zero settlements fetched for ${region.name} (${region.iso}) — query may have failed`);
    }

    const { settlements, stats } = deduplicateSettlements(allSettlements);

    console.log(`  Dropped by duplicate OSM ID: ${stats.droppedById}`);
    console.log(`  Dropped by duplicate (name,muni,3dec coords): ${stats.droppedByCoords}`);
    console.log(`  Dropped place=locality: ${stats.droppedLocalities}`);
    console.log(`  Dropped junk names: ${stats.droppedJunk}`);

    // Sort by municipality, then name
    settlements.sort((a, b) => {
      const m = a.municipality.localeCompare(b.municipality);
      if (m !== 0) return m;
      return a.name.localeCompare(b.name);
    });

    // Ensure output directory exists
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    // Write output
    fs.writeFileSync(outFile, JSON.stringify(settlements));
    const size = fs.statSync(outFile).size;
    console.log(`  Written ${outFile} (${(size / 1024).toFixed(1)} KB raw)`);

    if (size > MAX_FILE_SIZE) {
      console.log(`  WARNING: File size ${(size / 1024 / 1024).toFixed(2)} MB exceeds 1.5 MB limit!`);
    }

    return {
      success: true,
      skipped: false,
      code: region.code,
      iso: region.iso,
      name: region.name,
      file: `settlements/${region.code}.json`,
      count: settlements.length,
      bytes: size,
      municipalities: municipalities.length,
      errors: unassigned.length
    };
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    return { success: false, code: region.code, error: err.message };
  }
}

async function writeRegionsIndex() {
  // Include all regions that have files on disk (newly built or existing)
  const existingFiles = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.json')) : [];
  const existingCodes = new Set(existingFiles.map(f => parseInt(f)));

  // Build region info from REGIONS table for all existing files
  const allRegions = [];
  for (const code of existingCodes) {
    const regionDef = REGIONS.find(r => r.code === code);
    if (!regionDef) continue; // skip unknown codes
    const file = path.join(OUT_DIR, `${code}.json`);
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    allRegions.push({
      code: code,
      iso: regionDef.iso,
      name: regionDef.name,
      file: `settlements/${code}.json`,
      count: data.length,
      bytes: fs.statSync(file).size
    });
  }

  const regions = allRegions.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const indexData = { regions, generatedAt: new Date().toISOString() };
  fs.writeFileSync(REGIONS_FILE, JSON.stringify(indexData, null, 2));
  console.log(`\nWritten regions index: ${REGIONS_FILE} (${regions.length} regions)`);
}

async function main() {
  const targets = runAll ? REGIONS : REGIONS.filter(r => r.code === parseInt(targetRegion));

  if (targets.length === 0) {
    console.error(`Unknown region code: ${targetRegion}`);
    process.exit(1);
  }

  console.log(`Target regions: ${targets.map(r => r.code).join(', ')}`);
  console.log(`Force overwrite: ${force}`);

  const results = [];
  const failures = [];

  for (const region of targets) {
    const result = await buildRegion(region, force);
    results.push(result);
    if (!result.success) {
      failures.push(result);
    }
    // Pause between regions to be nice to Overpass
    if (targets.indexOf(region) < targets.length - 1) {
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Write regions index with all successful builds (including skipped)
  const allSuccessful = results.filter(r => r.success);
  await writeRegionsIndex(allSuccessful);

  // Summary
  console.log('\n=== BUILD SUMMARY ===');
  console.log(`Total targets: ${targets.length}`);
  console.log(`Successful: ${results.filter(r => r.success && !r.skipped).length}`);
  console.log(`Skipped (existed): ${results.filter(r => r.skipped).length}`);
  console.log(`Failed: ${failures.length}`);

  if (failures.length > 0) {
    console.log('\nFailed regions:');
    for (const f of failures) {
      console.log(`  ${f.code}: ${f.error}`);
    }
  }

  const totalBytes = allSuccessful.reduce((sum, r) => sum + (r.bytes || 0), 0);
  const largest = allSuccessful.reduce((max, r) => (r.bytes > (max.bytes || 0) ? r : max), { bytes: 0 });
  console.log(`\nTotal data size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB raw`);
  console.log(`Largest region: ${largest.name} (${largest.code}) — ${(largest.bytes / 1024 / 1024).toFixed(2)} MB`);

  if (failures.length > 0) {
    console.log('\nSome regions failed but rest committed. Re-run with --force to retry.');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});