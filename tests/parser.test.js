import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { hasFlag, normalizeHeader, parseDate, parseWorkbook } from '../src/modules/parser.js';

const here = dirname(fileURLToPath(import.meta.url));

function makeBuffer(rows) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Выгрузка');
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
}

function ymd(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

describe('normalizeHeader', () => {
  it('collapses NBSP, newlines, tabs and matches ё to е', () => {
    expect(normalizeHeader('  Владелец\u00a0')).toBe('владелец');
    expect(normalizeHeader('Дата\nТО')).toBe('дата то');
    expect(normalizeHeader('Группа\tвладельца')).toBe('группа владельца');
    expect(normalizeHeader('Дата след. ТО')).toBe('дата след. то');
    expect(normalizeHeader('Вывезена за рубеж')).toBe('вывезена за рубеж');
  });
});

describe('parseDate', () => {
  it('parses Date objects at local midnight', () => {
    expect(ymd(parseDate(new Date(2027, 1, 1)))).toEqual([2027, 2, 1]);
  });

  it('parses Excel serial numbers', () => {
    expect(ymd(parseDate(25569))).toEqual([1970, 1, 1]);
  });

  it('parses ДД.ММ.ГГГГ and ГГГГ-ММ-ДД strings', () => {
    expect(ymd(parseDate('01.02.2027'))).toEqual([2027, 2, 1]);
    expect(ymd(parseDate('5.6.2026'))).toEqual([2026, 6, 5]);
    expect(ymd(parseDate('2027-02-01'))).toEqual([2027, 2, 1]);
    expect(ymd(parseDate('2026/12/31 0:00:00'))).toEqual([2026, 12, 31]);
  });

  it('returns null for empty and invalid values', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('abc')).toBeNull();
    expect(parseDate('32.13.2027')).toBeNull();
  });
});

describe('hasFlag', () => {
  it('treats positive tokens and dates as set', () => {
    expect(hasFlag('Да')).toBe(true);
    expect(hasFlag('1')).toBe(true);
    expect(hasFlag(1)).toBe(true);
    expect(hasFlag(true)).toBe(true);
    expect(hasFlag(new Date(2027, 0, 1))).toBe(true);
  });

  it('treats empty and negative tokens as unset', () => {
    expect(hasFlag('')).toBe(false);
    expect(hasFlag('0')).toBe(false);
    expect(hasFlag('нет')).toBe(false);
    expect(hasFlag(null)).toBe(false);
  });
});

describe('parseWorkbook', () => {
  it('finds the header row after a title and blank rows', () => {
    const buffer = makeBuffer([
      ['Выгрузка на 23.11.2026'],
      [],
      [],
      ['Владелец\u00a0', 'Дата\nТО', 'ИНН', 'Адрес владельца'],
      ['ООО «Заря»', '15.03.2024', '7701000001', 'г. Москва'],
    ]);
    const result = parseWorkbook(buffer);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].owner).toBe('ООО «Заря»');
    expect(ymd(result.records[0].lastTo)).toEqual([2024, 3, 15]);
    expect(result.records[0].inn).toBe('7701000001');
  });

  it('reads flags from their columns', () => {
    const buffer = makeBuffer([
      ['Владелец', 'Дата ТО', 'Угон', 'Без ТО', 'Сдан ГРЗ', 'Вывезена за рубеж'],
      ['Иванов И.И.', '01.02.2024', 'Да', '', '1', 'нет'],
    ]);
    const record = parseWorkbook(buffer).records[0];
    expect(record.flags).toEqual({
      ugon: true,
      bezTo: false,
      sdanGrz: true,
      vyvezena: false,
    });
  });

  it('throws when a required column is missing', () => {
    expect(() => parseWorkbook(makeBuffer([['Владелец'], ['ООО «Заря»']]))).toThrow(
      /Дата ТО/,
    );
    expect(() => parseWorkbook(makeBuffer([['Дата ТО'], ['01.02.2024']]))).toThrow(
      /Владелец/,
    );
  });

  it('throws when no header row is present', () => {
    expect(() => parseWorkbook(makeBuffer([['просто', 'данные']]))).toThrow(/заголовков/);
  });

  it('parses the committed fictitious fixture', () => {
    const buffer = readFileSync(resolve(here, 'fixtures', 'sample.xlsx'));
    const { records } = parseWorkbook(buffer);
    expect(records.length).toBe(40);
    expect(records.some((record) => record.category === 'А4' || record.category === 'A4')).toBe(
      true,
    );
    expect(records.some((record) => record.removalDate !== null)).toBe(true);
    expect(records.some((record) => record.flags.ugon)).toBe(true);
  });
});
