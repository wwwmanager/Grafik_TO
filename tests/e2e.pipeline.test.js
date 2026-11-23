import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { getDayOfYear } from '../src/modules/calendarService.js';
import { exportScheduleToXlsx } from '../src/modules/exporter.js';
import { parseWorkbook } from '../src/modules/parser.js';
import { buildSchedule } from '../src/modules/scheduler.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const SETTINGS = {
  targetYear: 2027,
  toDepthYears: 3,
  groupWindowDays: 30,
  smallPhysicalMode: 'B',
  inspectionAddress: 'г. Москва, ул. Инспекции, 1',
  acceptingDays: [1],
  workStart: '09:00',
  workEnd: '18:00',
  lunch: { enabled: true, start: '12:00', end: '13:00' },
  perHour: 12,
  travelMinutes: 60,
};

function loadFixture() {
  const buffer = readFileSync(resolve(root, 'tests/fixtures/sample.xlsx'));
  return parseWorkbook(buffer);
}

function loadCalendar(year) {
  return JSON.parse(readFileSync(resolve(root, `public/calendar/${year}.json`), 'utf8'));
}

describe('end-to-end pipeline on the fictitious fixture', () => {
  const { records } = loadFixture();
  const calendar = loadCalendar(SETTINGS.targetYear);
  const result = buildSchedule(records, SETTINGS, calendar);

  it('parses the fixture and produces visits and exclusions', () => {
    expect(records).toHaveLength(40);
    expect(result.visits.length).toBeGreaterThan(0);
    expect(result.excluded.length).toBeGreaterThan(0);
    expect(result.notes).toHaveLength(1);
  });

  it('places every visit on an allowed working day of the target year', () => {
    for (const visit of result.visits) {
      expect(visit.date.getFullYear()).toBe(SETTINGS.targetYear);
      expect(calendar.days[getDayOfYear(visit.date)]).toBe(0);
      expect(visit.date.getDay()).not.toBe(1);
      expect(visit.startMin).toBeGreaterThanOrEqual(9 * 60);
      expect(visit.endMin).toBeLessThanOrEqual(18 * 60);
      expect(visit.endMin).toBeGreaterThan(visit.startMin);
    }
  });

  it('keeps the monthly summary consistent with the visits', () => {
    expect(result.summary.months).toHaveLength(12);
    const machines = result.summary.months.reduce((sum, month) => sum + month.machines, 0);
    const visits = result.summary.months.reduce((sum, month) => sum + month.visits, 0);
    expect(visits).toBe(result.visits.length);
    expect(machines).toBe(result.summary.machines);
  });

  it('exports a workbook whose sheets match the pipeline result', async () => {
    const buffer = await exportScheduleToXlsx(result, SETTINGS);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'График ТО',
      'Детализация',
      'Исключенные записи',
      'Сводка и нагрузка',
    ]);
    const schedule = workbook.getWorksheet('График ТО');
    // header + one row per visit (+ optional note rows)
    expect(schedule.rowCount).toBeGreaterThanOrEqual(result.visits.length + 1);
    const excluded = workbook.getWorksheet('Исключенные записи');
    expect(excluded.rowCount).toBe(result.excluded.length + 1);
  });
});
