// Loads the Russian production calendar for a year and decides whether a date is
// a valid field-visit working day. The only permitted network request is
// https://isdayoff.ru (no user data). Falls back to bundled JSON, then to weekends.
const API_URL = 'https://isdayoff.ru/api/getdata';
const CACHE_PREFIX = 'grafik-to:calendar:';
const REQUEST_TIMEOUT_MS = 5000;

export function daysInYear(year) {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return leap ? 366 : 365;
}

// isdayoff.ru returns one digit per day: 0 = working, 1 = non-working.
export function parseApiString(text, year) {
  const clean = String(text ?? '').trim();
  if (clean.length !== daysInYear(year) || !/^[01]+$/.test(clean)) return null;
  return Array.from(clean, (value) => (value === '1' ? 1 : 0));
}

export function buildWeekendCalendar(year) {
  const total = daysInYear(year);
  const days = new Array(total).fill(0);
  const cursor = new Date(year, 0, 1);
  for (let index = 0; index < total; index += 1) {
    const weekday = cursor.getDay();
    days[index] = weekday === 0 || weekday === 6 ? 1 : 0;
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function getDayOfYear(date) {
  const start = Date.UTC(date.getFullYear(), 0, 1);
  const current = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((current - start) / 86400000);
}

function toDate(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === 'string' && value) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  return null;
}

function inVacation(date, vacation) {
  if (!vacation || !vacation.enabled) return false;
  const from = toDate(vacation.from);
  const to = toDate(vacation.to);
  if (!from && !to) return false;
  const time = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (from && time < from.getTime()) return false;
  if (to && time > to.getTime()) return false;
  return true;
}

// A date is a field-visit working day when it is not a production-calendar day
// off, not an inspection "accepting" weekday, and not inside the inspector's vacation.
export function isWorkingDay(date, settings = {}, calendar = null) {
  const off =
    calendar && Array.isArray(calendar.days) ? calendar.days[getDayOfYear(date)] === 1 : false;
  if (off) return false;
  const accepting = Array.isArray(settings.acceptingDays) ? settings.acceptingDays : [];
  if (accepting.includes(date.getDay())) return false;
  if (inVacation(date, settings.vacation)) return false;
  return true;
}

function getStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Access to storage can throw in hardened privacy modes; fall back to no cache.
  }
  return null;
}

function readCache(storage, year) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(`${CACHE_PREFIX}${year}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      parsed.year === year &&
      Array.isArray(parsed.days) &&
      parsed.days.length === daysInYear(year)
    ) {
      return parsed;
    }
  } catch {
    // Corrupt cache is ignored and refetched.
  }
  return null;
}

function writeCache(storage, year, payload) {
  if (!storage) return;
  try {
    storage.setItem(`${CACHE_PREFIX}${year}`, JSON.stringify(payload));
  } catch {
    // Quota/denied storage should not break scheduling.
  }
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function bundledUrl(year) {
  let base = './';
  try {
    if (import.meta.env && import.meta.env.BASE_URL) base = import.meta.env.BASE_URL;
  } catch {
    // import.meta.env is absent outside Vite/Vitest; keep the relative default.
  }
  return `${base}calendar/${year}.json`;
}

// Returns { year, days, source: 'cache'|'api'|'bundled'|'weekend', warning }.
// warning=true only for an unknown year resolved to a weekends-only calendar.
export async function loadProductionCalendar(year, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const storage = options.storage === undefined ? getStorage() : options.storage;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const allowApi = options.allowApi !== false;

  const cached = readCache(storage, year);
  if (cached) {
    return { year, days: cached.days, source: 'cache', warning: false };
  }

  const result = { year, days: null, source: 'weekend', warning: true };

  if (allowApi && typeof fetchImpl === 'function') {
    try {
      const response = await fetchWithTimeout(fetchImpl, `${API_URL}?year=${year}`, timeoutMs);
      if (response && response.ok) {
        const days = parseApiString(await response.text(), year);
        if (days) {
          result.days = days;
          result.source = 'api';
          result.warning = false;
        }
      }
    } catch {
      // Network/CORS failure: fall back to the bundled calendar.
    }
  }

  if (!result.days && typeof fetchImpl === 'function') {
    try {
      const response = await fetchWithTimeout(fetchImpl, bundledUrl(year), timeoutMs);
      if (response && response.ok) {
        const data = await response.json();
        if (
          data &&
          data.year === year &&
          Array.isArray(data.days) &&
          data.days.length === daysInYear(year)
        ) {
          result.days = data.days.map((value) => (Number(value) === 1 ? 1 : 0));
          result.source = 'bundled';
          result.warning = false;
        }
      }
    } catch {
      // No bundled calendar for this year either.
    }
  }

  if (!result.days) {
    result.days = buildWeekendCalendar(year);
    result.source = 'weekend';
    result.warning = true;
  }

  if (result.source !== 'weekend') {
    writeCache(storage, year, { year, days: result.days, source: result.source });
  }
  return result;
}
