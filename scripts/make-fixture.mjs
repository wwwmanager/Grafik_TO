// Generates tests/fixtures/sample.xlsx: a fictitious registry export with a
// title row, two blank rows and the header row from docs/spec/headers-sample.txt.
// All data is fictional. Run: node scripts/make-fixture.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as XLSX from 'xlsx';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const specLines = readFileSync(resolve(root, 'docs/spec/headers-sample.txt'), 'utf8').split(/\r?\n/);
const headerLine = specLines.find((line) => line.includes('\t') && line.includes('Владелец'));
if (!headerLine) throw new Error('headers-sample.txt: header line not found');
const headers = headerLine.split('\t').map((value) => value.trim());

const owners = [
  { name: 'ООО «Заря»', group: 'Юридические лица', inn: '7701000001', address: 'г. Москва, ул. Ленина, д. 1', count: 8 },
  { name: 'АО «Поле»', group: 'Юридические лица', inn: '7702000002', address: 'Московская обл., Одинцовский р-н, г. Одинцово, ул. Мира, 5', count: 7 },
  { name: 'ООО «Лесное»', group: 'Юридические лица', inn: '7703000003', address: 'Московская обл., Дмитровский р-н, с. Рогачёво, ул. Садовая, 3', count: 6 },
  { name: 'Петров Пётр Петрович', group: 'Физические лица', inn: '', address: 'Московская обл., Клинский р-н, г. Клин, ул. Гагарина, 7', count: 3 },
  { name: 'Сидорова Анна Сергеевна', group: 'Физические лица', inn: '5001000004', address: 'Московская обл., Клинский р-н, д. Бородино, ул. Полевая, 2', count: 2 },
  { name: 'Кузнецов Олег Ильич', group: 'Физические лица', inn: '', address: 'Московская обл., Дмитровский р-н, с. Рогачёво, пер. Школьный, 4', count: 1 },
  { name: 'ГБУ «Техника»', group: 'Юридические лица', inn: '7705000005', address: 'г. Москва, ул. Строителей, 12', count: 5 },
  { name: 'Фермеров Иван Иванович', group: 'Физические лица', inn: '5002000006', address: 'Московская обл., Одинцовский р-н, п. Лесной, ул. Центральная, 9', count: 5 },
  { name: 'ООО «Коммунальщик»', group: 'Юридические лица', inn: '7707000007', address: 'Московская обл., Клинский р-н, г. Клин, ул. Заводская, 15', count: 3 },
];

const brands = ['МТЗ-82', 'ДТ-75', 'Кировец К-744', 'ЮМЗ-6', 'ЛТЗ-60', 'Т-150К'];
const categories = ['B', 'C', 'D', 'E'];
const toDates = ['15.03.2019', '20.06.2020', '01.02.2024', '12.09.2025', '10.01.2026', ''];

const rows = [];
let serial = 1;
for (const owner of owners) {
  for (let unit = 0; unit < owner.count; unit += 1) {
    const index = serial - 1;
    const isA4 = index % 7 === 0;
    const row = Object.fromEntries(headers.map((header) => [header, '']));
    row['Дата регистрации'] = '01.01.2019';
    row['№'] = String(serial);
    row['Владелец'] = owner.name;
    row['Инспекция'] = 'Инспекция 1';
    row['Гос. рег. знак'] = `А${(100 + serial).toString().padStart(3, '0')}ММ77`;
    row['Дата ТО'] = toDates[index % toDates.length];
    row['Марка'] = brands[index % brands.length];
    row['Наименование'] = 'Трактор';
    row['Зав. №'] = `Z${(1000 + serial).toString()}`;
    row['Категория'] = isA4 ? (index % 2 === 0 ? 'А4' : 'A4') : categories[index % categories.length];
    row['Адрес владельца'] = owner.address;
    row['Группа владельца'] = owner.group;
    row['ИНН'] = owner.inn;
    row['Угон'] = index % 13 === 0 ? 'Да' : '';
    // D12: «Без ТО» = «*» marks an overdue unit that must be scheduled. Index 17 also
    // hits an empty «Дата ТО» (index % 6 === 5), covering the D13 no-date case.
    row['Без ТО'] = index % 17 === 0 ? '*' : '';
    row['Сдан ГРЗ'] = index % 19 === 0 ? 'да' : '';
    row['Вывезена за рубеж'] = index % 29 === 0 ? 'Да' : '';
    row['Дата снятия'] = index % 10 === 0 ? '10.05.2025' : '';
    row['Дата след. ТО'] = index % 5 === 0 ? '15.03.2027' : '';
    rows.push(row);
    serial += 1;
  }
}

const aoa = [['Выгрузка на 23.11.2026'], [], [], headers];
for (const row of rows) {
  aoa.push(headers.map((header) => row[header] ?? ''));
}

const sheet = XLSX.utils.aoa_to_sheet(aoa);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, 'Выгрузка');

const outDir = resolve(root, 'tests/fixtures');
mkdirSync(outDir, { recursive: true });
const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
writeFileSync(resolve(outDir, 'sample.xlsx'), buffer);
console.log(`fixture written: ${rows.length} rows, ${headers.length} columns`);
