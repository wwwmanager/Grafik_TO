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
    expect(row.getCell(1).value).toBe(1);
    expect(row.getCell(7).value).toBe('—|москва');
    expect(String(row.getCell(11).value)).toContain('А001ММ77');
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
    expect(details.getRow(2).getCell(3).value).toBe('с 9-00 до 9-30');
  });

  it('merges a small owner into one row and lists unit target dates (GRAFIK-14)', async () => {
    const units = [
      record({
        owner: 'ООО «Малый»',
        inn: '7700000009',
        plate: 'А201ММ77',
        nextTo: new Date(2026, 1, 10),
      }),
      record({
        owner: 'ООО «Малый»',
        inn: '7700000009',
        plate: 'А202ММ77',
        nextTo: new Date(2026, 9, 10),
      }),
    ];
    const grouped = buildSchedule(units, SETTINGS, CALENDAR);
    expect(grouped.visits).toHaveLength(1);

    const workbook = await loadWorkbook(await exportScheduleToXlsx(grouped, SETTINGS));
    const schedule = workbook.getWorksheet('График ТО');
    expect(schedule.rowCount).toBe(2);
    expect(schedule.getRow(2).getCell(2).value).toBe('ООО «Малый»');

    const details = workbook.getWorksheet('Детализация');
    expect(details.getRow(2).getCell(1).value).toBe(1);
    const unitCell = String(details.getRow(2).getCell(15).value);
    expect(unitCell).toContain('А201ММ77');
    expect(unitCell).toContain('10.02.2026');
    expect(unitCell).toContain('А202ММ77');
    expect(unitCell).toContain('10.10.2026');
  });

  it('renders vehicles and unit dates as numbered lines with wrap (GRAFIK-17)', async () => {
    const units = [
      record({
        owner: 'ООО «Малый»',
        inn: '7700000011',
        plate: 'А201ММ77',
        brand: 'Lada',
        nextTo: new Date(2026, 1, 10),
      }),
      record({
        owner: 'ООО «Малый»',
        inn: '7700000011',
        plate: 'А202ММ77',
        brand: 'Kamaz',
        nextTo: new Date(2026, 9, 10),
      }),
    ];
    const grouped = buildSchedule(units, SETTINGS, CALENDAR);
    const workbook = await loadWorkbook(await exportScheduleToXlsx(grouped, SETTINGS));
    const details = workbook.getWorksheet('Детализация');

    const vehiclesCell = details.getRow(2).getCell(11);
    expect(vehiclesCell.value).toBe('1. А201ММ77 — Lada\n2. А202ММ77 — Kamaz');
    expect(vehiclesCell.alignment?.wrapText).toBe(true);

    const unitsCell = details.getRow(2).getCell(15);
    const unitsText = String(unitsCell.value);
    expect(unitsText).toContain('1. А201ММ77 (Lada)');
    expect(unitsText).toContain('10.02.2026');
    expect(unitsText).toContain('\n');
    expect(unitsText).toContain('А202ММ77 (Kamaz)');
    expect(unitsText).toContain('10.10.2026');
    expect(unitsCell.alignment?.wrapText).toBe(true);
  });

  it('numbers details rows with the matching schedule visit number (GRAFIK-22)', async () => {    const multi = [
      record({ owner: 'ООО «Первый»', inn: '7700000101' }),
      record({
        owner: 'ООО «Второй»',
        inn: '7700000102',
        plate: 'В002ВВ77',
        address: 'Московская обл, г. Химки, ул. Мира, 2',
        nextTo: new Date(2026, 7, 15),
      }),
    ];
    const multiResult = buildSchedule(multi, SETTINGS, CALENDAR);
    expect(multiResult.visits.length).toBeGreaterThanOrEqual(2);

    const workbook = await loadWorkbook(await exportScheduleToXlsx(multiResult, SETTINGS));
    const schedule = workbook.getWorksheet('График ТО');
    const details = workbook.getWorksheet('Детализация');
    expect(schedule.getRow(1).getCell(1).value).toBe('№ п/п');
    expect(details.getRow(1).getCell(1).value).toBe('№ п/п');
    for (let index = 0; index < multiResult.visits.length; index += 1) {
      const rowNumber = index + 2;
      expect(schedule.getRow(rowNumber).getCell(1).value).toBe(index + 1);
      expect(details.getRow(rowNumber).getCell(1).value).toBe(index + 1);
    }
  });

  it('uses the renamed stale-date exclusion reason (GRAFIK-17)', () => {
    const stale = record({
      owner: 'ООО «Старое»',
      inn: '43',
      lastTo: new Date(2020, 0, 1),
      nextTo: null,
    });
    const staleResult = buildSchedule([stale], SETTINGS, CALENDAR);
    expect(staleResult.excluded[0].reason).toBe('Дата ТО больше выбранной давности ТО');
  });

  it('fits schedule column widths to content with sensible caps (GRAFIK-23)', async () => {
    const workbook = await loadWorkbook(await exportScheduleToXlsx(result, SETTINGS));
    const sheet = workbook.getWorksheet('График ТО');
    const widths = [1, 2, 3, 4].map((column) => sheet.getColumn(column).width);
    expect(widths[0]).toBeLessThanOrEqual(8);
    expect(widths[1]).toBeGreaterThanOrEqual(24);
    expect(widths[1]).toBeLessThanOrEqual(40);
    expect(widths[2]).toBeGreaterThanOrEqual(12);
    expect(widths[3]).toBeGreaterThanOrEqual(12);
    for (const width of widths) {
      expect(Number.isFinite(width)).toBe(true);
      expect(width).toBeLessThanOrEqual(48);
    }
  });

  it('caps a very long owner name instead of over-widening the column (GRAFIK-23)', async () => {
    const longOwner = 'ООО «Очень длинное наименование организации с филиалами и подразделениями»';
    const longResult = buildSchedule(
      [record({ owner: longOwner, inn: '7700000200' })],
      SETTINGS,
      CALENDAR,
    );
    const workbook = await loadWorkbook(await exportScheduleToXlsx(longResult, SETTINGS));
    const sheet = workbook.getWorksheet('График ТО');
    expect(sheet.getColumn(2).width).toBeLessThanOrEqual(40);
    expect(sheet.getColumn(2).width).toBeGreaterThanOrEqual(24);
  });

  it('splits inspection/travel minutes and labels target dates (GRAFIK-26)', async () => {
    const group = [
      record({ owner: 'ООО «Два адреса»', inn: '7700000401', nextTo: new Date(2026, 5, 10) }),
      record({
        owner: 'ООО «Два адреса»',
        inn: '7700000401',
        plate: 'А002ММ77',
        address: 'Московская обл., Одинцовский р-н, г. Одинцово, ул. Мира, 5',
        nextTo: new Date(2026, 5, 10),
      }),
    ];
    const groupSettings = { ...SETTINGS, travelMinutes: 30, exportDate: new Date(2026, 10, 23) };
    const groupedResult = buildSchedule(group, groupSettings, CALENDAR);
    const workbook = await loadWorkbook(await exportScheduleToXlsx(groupedResult, groupSettings));
    const details = workbook.getWorksheet('Детализация');
    const header = details.getRow(1);
    expect(header.getCell(9).value).toBe('Длительность осмотра, мин');
    expect(header.getCell(10).value).toBe('Переезд, мин');
    expect(header.getCell(15).value).toBe('Единицы и целевая дата ТО');
    const row = details.getRow(2);
    expect(row.getCell(9).value).toBe(30);
    expect(row.getCell(10).value).toBe(30);
    expect(String(row.getCell(15).value)).toContain('Просрочен (10.06.2026)');
  });

  it('vertically centres every cell on both main sheets (GRAFIK-24)', async () => {
    const workbook = await loadWorkbook(await exportScheduleToXlsx(result, SETTINGS));
    for (const sheetName of ['График ТО', 'Детализация']) {
      const sheet = workbook.getWorksheet(sheetName);
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          expect(cell.alignment?.vertical).toBe('middle');
          expect(cell.alignment?.wrapText).toBe(true);
        });
      });
    }
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
