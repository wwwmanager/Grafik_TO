import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  exportScheduleToXlsx,
  formatDate,
  formatTimeLabel,
  formatTimeRange,
} from '../src/modules/exporter.js';
import { buildSchedule } from '../src/modules/scheduler.js';

const CALENDAR = { days: new Array(365).fill(0), source: 'test', warning: false };

const SETTINGS = {
  targetYear: 2026,
  toDepthYears: 3,
  workStart: '09:00',
  workEnd: '18:00',
  lunch: { enabled: true, start: '12:00', end: '13:00' },
  perHour: 12,
  travelMinutes: 60,
  acceptingDays: [],
  groupWindowDays: 30,
  smallPhysicalMode: 'A',
  inspectionAddress: 'г. Москва, ул. Инспекции, 1',
};

function record(overrides = {}) {
  return {
    owner: 'ООО «Альфа»',
    ownerGroup: 'Юридические лица',
    inn: '7701000001',
    address: 'г. Москва, ул. Ленина, 1',
    category: 'B',
    plate: 'А001ММ77',
    brand: 'МТЗ',
    name: 'Трактор',
    serial: 'Z1',
    lastTo: new Date(2025, 0, 1),
    nextTo: new Date(2026, 5, 10),
    removalDate: null,
    flags: { ugon: false, bezTo: false, sdanGrz: false, vyvezena: false },
    ...overrides,
  };
}

async function loadWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

function columnValues(sheet, column) {
  const values = [];
  sheet.eachRow((row) => values.push(row.getCell(column).value));
  return values;
}

describe('formatting helpers', () => {
  it('formats dates and times for the workbook', () => {
    expect(formatDate(new Date(2026, 5, 10))).toBe('10.06.2026');
    expect(formatTimeLabel(9 * 60)).toBe('с 9-00');
    expect(formatTimeLabel(9 * 60 + 30)).toBe('с 9-30');
    expect(formatTimeRange(9 * 60, 10 * 60)).toBe('с 9-00 до 10-00');
  });
});

describe('exportScheduleToXlsx', () => {
  const records = [
    record(),
    record({ owner: 'ООО «Угон»', inn: '3', flags: { ugon: true } }),
    record({ owner: 'Петров Пётр', ownerGroup: 'Физические лица', inn: '', plate: 'А010ММ77' }),
    record({ owner: 'Петров Пётр', ownerGroup: 'Физические лица', inn: '', plate: 'А011ММ77' }),
  ];
  const result = buildSchedule(records, SETTINGS, CALENDAR);

  it('writes the four named sheets', async () => {
    const workbook = await loadWorkbook(await exportScheduleToXlsx(result, SETTINGS));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'График ТО',
      'Детализация',
      'Исключенные записи',
      'Сводка и нагрузка',
    ]);
  });

  it('fills the main schedule sheet from visits', async () => {
    const workbook = await loadWorkbook(await exportScheduleToXlsx(result, SETTINGS));
    const sheet = workbook.getWorksheet('График ТО');
    const row = sheet.getRow(2);
    expect(row.getCell(1).value).toBe(1);
    expect(row.getCell(2).value).toBe('ООО «Альфа»');
    expect(row.getCell(3).value).toBe('10.06.2026');
    expect(row.getCell(4).value).toBe('с 9-00');
  });

  it('writes details with location key and vehicles', async () => {
    const workbook = await loadWorkbook(await exportScheduleToXlsx(result, SETTINGS));
    const sheet = workbook.getWorksheet('Детализация');
    const row = sheet.getRow(2);
    expect(row.getCell(6).value).toBe('—|москва');
    expect(String(row.getCell(9).value)).toContain('А001ММ77');
  });

  it('lists excluded records with reasons', async () => {
    const workbook = await loadWorkbook(await exportScheduleToXlsx(result, SETTINGS));
    const reasons = columnValues(workbook.getWorksheet('Исключенные записи'), 9);
    expect(reasons).toContain('Угон');
    expect(reasons.some((reason) => String(reason).includes('Физлицо'))).toBe(true);
  });

  it('summarises months and applied settings', async () => {
    const workbook = await loadWorkbook(await exportScheduleToXlsx(result, SETTINGS));
    const sheet = workbook.getWorksheet('Сводка и нагрузка');
    const months = columnValues(sheet, 1);
    const juneIndex = months.indexOf('Июнь') + 1;
    expect(juneIndex).toBeGreaterThan(0);
    expect(sheet.getRow(juneIndex).getCell(2).value).toBe(1);
    expect(months).toContain('Итого');
    const labels = columnValues(sheet, 1).map((value) => String(value));
    expect(labels).toContain('Приёмные дни недели');
    expect(labels).toContain('Адрес инспекции');
    expect(labels).toContain('Порог физлиц, ед. техники');
    expect(labels).toContain('Загрузка зимних месяцев, %');
  });

  it('keeps the schedule name clean and formats details time with «до»', async () => {
    const overdue = record({
      owner: 'ООО «Старое»',
      inn: '42',
      lastTo: new Date(2023, 5, 1),
      nextTo: null,
    });
    const overdueResult = buildSchedule([overdue], SETTINGS, CALENDAR);
    const visit = overdueResult.visits.find((entry) => entry.overdue);
    expect(visit).toBeTruthy();
    const workbook = await loadWorkbook(await exportScheduleToXlsx(overdueResult, SETTINGS));

    const schedule = workbook.getWorksheet('График ТО');
    const scheduleName = schedule.getRow(2).getCell(2).value;
    expect(scheduleName).toBe('ООО «Старое»');
    expect(String(scheduleName)).not.toContain('просроченная');

    const details = workbook.getWorksheet('Детализация');
    expect(details.getRow(2).getCell(2).value).toBe('с 9-00 до 10-00');
  });

  it('appends the reception note when mode B excludes individuals', async () => {
    const modeB = buildSchedule(records, { ...SETTINGS, smallPhysicalMode: 'B' }, CALENDAR);
    expect(modeB.notes).toHaveLength(1);
    const workbook = await loadWorkbook(await exportScheduleToXlsx(modeB, SETTINGS));
    const sheet = workbook.getWorksheet('График ТО');
    const texts = columnValues(sheet, 1).map((value) => String(value));
    expect(texts.some((text) => text.includes('Физические лица'))).toBe(true);
  });
});
