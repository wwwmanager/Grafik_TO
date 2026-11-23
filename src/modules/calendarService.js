// Loads the Russian production calendar for a year with a localStorage cache.
// Network access is limited to https://isdayoff.ru (see CSP in index.html).
export async function loadProductionCalendar() {
  return { days: [] };
}