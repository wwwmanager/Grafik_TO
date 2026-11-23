// Fetches the Russian production calendar for the bundled fallback years from
// isdayoff.ru and writes public/calendar/<year>.json. Run once with network:
//   node scripts/make-calendar.mjs
// The JSON files are committed so the app works offline / when CORS blocks the API.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const years = [2025, 2026, 2027];

function daysInYear(year) {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return leap ? 366 : 365;
}

const outDir = resolve(root, 'public/calendar');
mkdirSync(outDir, { recursive: true });

for (const year of years) {
  const url = `https://isdayoff.ru/api/getdata?year=${year}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${year}: HTTP ${response.status}`);
  const text = (await response.text()).trim();
  const expected = daysInYear(year);
  if (text.length !== expected || !/^[01]+$/.test(text)) {
    throw new Error(`${year}: unexpected payload length ${text.length} (expected ${expected})`);
  }
  const days = Array.from(text, (value) => (value === '1' ? 1 : 0));
  const payload = { year, source: 'isdayoff.ru', days };
  writeFileSync(resolve(outDir, `${year}.json`), `${JSON.stringify(payload)}\n`);
  console.log(`${year}: ${days.length} days, ${days.filter((d) => d === 1).length} days off`);
}
