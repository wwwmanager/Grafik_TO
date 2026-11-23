// Parses an uploaded .xlsx/.xls workbook into normalized records.
// SheetJS reads the workbook; the real export has a title row and the header row
// is not the first row, so headers are located by scanning the leading rows.
import * as XLSX from 'xlsx';

const HEADER_SCAN_LIMIT = 30;

const TEXT_FIELDS = {
  владелец: 'owner',
  'группа владельца': 'ownerGroup',
  инн: 'inn',
  'адрес владельца': 'address',
  категория: 'category',
  'гос. рег. знак': 'plate',
  марка: 'brand',
  наименование: 'name',
  'зав. №': 'serial',
  'зав. номер': 'serial',
};

const DATE_FIELDS = {
  'дата то': 'lastTo',
  'дата след. то': 'nextTo',
  'дата снятия': 'removalDate',
};

const FLAG_FIELDS = {
  угон: 'ugon',
  'без то': 'bezTo',
  'сдан грз': 'sdanGrz',
  'вывезена за рубеж': 'vyvezena',
};

const REQUIRED = [
  { header: 'владелец', label: 'Владелец' },
  { header: 'дата то', label: 'Дата ТО' },
];

const FALSE_TOKENS = new Set(['', '0', 'нет', 'no', 'false', '-', '—', '–']);

// Normalizes a header cell: NBSP -> space, collapse whitespace/newlines/tabs,
// ё -> е, trim, lowercase. Used only for column lookup, never for display.
export function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ё/g, 'е')
    .replace(/Ё/g, 'Е')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function atLocalMidnight(year, monthIndex, day) {
  const date = new Date(year, monthIndex, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

// Accepts a Date, an Excel serial number, or a string in ДД.ММ.ГГГГ / ГГГГ-ММ-ДД
// form (also . and / separators, optional trailing time). Returns a Date at local
// midnight or null when the value is missing/invalid.
export function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return atLocalMidnight(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + Math.round(value * 86400000));
    return atLocalMidnight(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  const text = String(value).trim();
  if (!text) return null;
  const cleaned = text.replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, '');
  let match = cleaned.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (match) return atLocalMidnight(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  match = cleaned.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (match) return atLocalMidnight(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return null;
}

// A flag column counts as "set" for any non-empty, non-negative token. Strings
// such as "Да", "1", "True" and dates are truthy; "0", "нет", "false" are not.
export function hasFlag(value) {
  if (value === null || value === undefined) return false;
  if (value instanceof Date) return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  const text = String(value).trim().toLowerCase();
  return !FALSE_TOKENS.has(text);
}

function toText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

// GRAFIK-16: the real export splits the address across columns whose headers carry
// part markers (Обл/Район/Нас. пункт/Улица/Дом, or the short Г/С/П codes). These
// sets classify a normalized header into one address part.
const ADDRESS_REGION_TOKENS = new Set([
  'обл',
  'область',
  'край',
  'ао',
  'аобл',
  'респ',
  'республика',
  'округ',
  'регион',
]);
const ADDRESS_DISTRICT_TOKENS = new Set(['р-н', 'район']);
const ADDRESS_SETTLEMENT_TOKENS = new Set([
  'г',
  'с',
  'п',
  'пгт',
  'д',
  'х',
  'ст-ца',
  'аул',
  'рп',
  'город',
  'село',
  'поселок',
  'посёлок',
  'деревня',
  'хутор',
  'станица',
  'населенный',
  'населённый',
  'нас',
]);
const ADDRESS_STREET_TOKENS = new Set([
  'ул',
  'улица',
  'пр-т',
  'проспект',
  'пр',
  'проезд',
  'пер',
  'переулок',
  'ш',
  'шоссе',
  'наб',
  'набережная',
  'пл',
  'площадь',
  'бул',
  'бульвар',
  'туп',
  'тупик',
  'мкр',
  'микрорайон',
  'кв-л',
  'квартал',
  'дор',
  'дорога',
]);
const ADDRESS_HOUSE_TOKENS = new Set([
  'дом',
  'корпус',
  'строение',
  'квартира',
  'офис',
  'помещение',
  'корп',
  'стр',
  'оф',
  'пом',
]);
const ADDRESS_ORDER = ['region', 'district', 'settlement', 'street', 'house'];

function addressHeaderTokens(norm) {
  return String(norm ?? '')
    .split(/[^а-яёa-z0-9-]+/u)
    .filter(Boolean);
}

function classifyAddressHeader(norm) {
  const tokens = addressHeaderTokens(norm);
  if (tokens.length === 0) return '';
  const has = (set) => tokens.some((token) => set.has(token));
  if (has(ADDRESS_DISTRICT_TOKENS)) return 'district';
  if (has(ADDRESS_REGION_TOKENS)) return 'region';
  if (has(ADDRESS_STREET_TOKENS)) return 'street';
  if (has(ADDRESS_HOUSE_TOKENS)) return 'house';
  if (has(ADDRESS_SETTLEMENT_TOKENS)) return 'settlement';
  return '';
}

function findAddressColumns(map) {
  const columns = { region: [], district: [], settlement: [], street: [], house: [] };
  for (const [norm, column] of map) {
    const kind = classifyAddressHeader(norm);
    if (kind) columns[kind].push(column);
  }
  for (const kind of ADDRESS_ORDER) columns[kind].sort((a, b) => a - b);
  return columns;
}

function findHeaderRow(rows) {
  const limit = Math.min(rows.length, HEADER_SCAN_LIMIT);
  const candidates = [];
  let both = null;
  for (let index = 0; index < limit; index += 1) {
    const cells = rows[index] || [];
    const norms = cells.map(normalizeHeader);
    const hasOwner = norms.includes('владелец');
    const hasTo = norms.includes('дата то');
    if (!hasOwner && !hasTo) continue;
    candidates.push({ index, cells, norms, hasOwner, hasTo });
    if (hasOwner && hasTo) {
      both = candidates[candidates.length - 1];
      break;
    }
  }
  if (candidates.length === 0) return null;
  const chosen = both || candidates[0];
  const map = new Map();
  const originals = [];
  chosen.norms.forEach((norm, column) => {
    if (!norm) return;
    if (!map.has(norm)) map.set(norm, column);
    originals.push(String(chosen.cells[column] ?? '').trim());
  });
  return {
    index: chosen.index,
    map,
    originals,
    hasOwner: chosen.hasOwner,
    hasTo: chosen.hasTo,
    addressColumns: findAddressColumns(map),
  };
}

function isRowEmpty(cells) {
  return (cells || []).every((cell) => String(cell ?? '').trim() === '');
}

function buildRecord(cells, header) {
  const raw = {};
  header.map.forEach((column, norm) => {
    raw[norm] = cells[column];
  });
  const pick = (norm) => {
    const column = header.map.get(norm);
    return column === undefined ? '' : cells[column];
  };

  const record = {
    owner: '',
    ownerGroup: '',
    inn: '',
    address: '',
    category: '',
    plate: '',
    brand: '',
    name: '',
    serial: '',
    lastTo: null,
    nextTo: null,
    removalDate: null,
    flags: { ugon: false, bezTo: false, sdanGrz: false, vyvezena: false },
    raw,
  };

  Object.entries(TEXT_FIELDS).forEach(([norm, field]) => {
    record[field] = toText(pick(norm));
  });
  Object.entries(DATE_FIELDS).forEach(([norm, field]) => {
    record[field] = parseDate(pick(norm));
  });
  Object.entries(FLAG_FIELDS).forEach(([norm, field]) => {
    record.flags[field] = hasFlag(pick(norm));
  });

  // GRAFIK-16: keep the single «Адрес владельца» value when present; otherwise
  // assemble the split address columns (region, district, settlement, street, house).
  if (!record.address) {
    const columns = header.addressColumns || {};
    const parts = [];
    for (const kind of ADDRESS_ORDER) {
      for (const column of columns[kind] || []) {
        const value = toText(cells[column]);
        if (value) parts.push(value);
      }
    }
    record.address = parts.join(', ');
  }

  return record;
}

// Reads the first sheet of an .xlsx/.xls workbook from an ArrayBuffer/Uint8Array
// and returns { records, headers, sheetName }. Throws a Russian-language error when
// the header row or a required column is missing.
export function parseWorkbook(data) {
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Файл не содержит листов.');
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

  const header = findHeaderRow(rows);
  if (!header) {
    throw new Error(
      'Не найдена строка заголовков с колонками «Владелец» и «Дата ТО».',
    );
  }
  const missing = REQUIRED.filter((item) => !header.map.has(item.header)).map(
    (item) => item.label,
  );
  if (missing.length > 0) {
    throw new Error(`В файле отсутствуют обязательные колонки: ${missing.join(', ')}.`);
  }

  const records = [];
  for (let index = header.index + 1; index < rows.length; index += 1) {
    const cells = rows[index] || [];
    if (isRowEmpty(cells)) continue;
    records.push(buildRecord(cells, header));
  }

  return { records, headers: header.originals, sheetName };
}
