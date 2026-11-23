import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadProductionCalendar } from '../src/modules/calendarService.js';
import { exportScheduleToXlsx } from '../src/modules/exporter.js';
import { parseWorkbook } from '../src/modules/parser.js';
import { buildSchedule } from '../src/modules/scheduler.js';
import { initUi } from '../src/modules/ui.js';

const here = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(here, '..', 'index.html'), 'utf8');

describe('scaffold', () => {
  it('exports every module stub', () => {
    const exports = [
      parseWorkbook,
      loadProductionCalendar,
      buildSchedule,
      exportScheduleToXlsx,
      initUi,
    ];
    for (const fn of exports) {
      expect(typeof fn).toBe('function');
    }
  });

  it('declares the Content-Security-Policy meta in index.html', () => {
    expect(indexHtml).toMatch(/http-equiv=["']Content-Security-Policy["']/i);
    expect(indexHtml).toContain("default-src 'self'");
    expect(indexHtml).toContain("connect-src 'self' https://isdayoff.ru");
  });
});