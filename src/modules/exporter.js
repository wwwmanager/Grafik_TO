// Serializes the schedule into a formatted .xlsx workbook (ExcelJS).
// Four sheets per TZ §7: График ТО, Детализация, Исключенные записи, Сводка и нагрузка.
import ExcelJS from 'exceljs';

import {
  formatDate,
  formatMaybeDate,
  formatTimeLabel,
  formatTimeRange,
  formatUnitTargets,
  formatVehicleList,
} from './format.js';

export { formatDate, formatTimeLabel, formatTimeRange } from './format.js';

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

const MONTHS_SHORT = [
  'Янв',
  'Фев',
  'Мар',
  'Апр',
  'Май',
  'Июн',
  'Июл',
  'Авг',
  'Сен',
  'Окт',
  'Ноя',
  'Дек',
];

function winterLabel(settings) {
  const months = Array.isArray(settings.winterMonths)
    ? settings.winterMonths
    : [11, 0, 1];
  const names = months
    .map((month) => MONTHS_SHORT[Number(month)])
    .filter(Boolean);
  return names.length > 0 ? names.join(', ') : 'нет';
}

const THIN = { style: 'thin', color: { argb: 'FFB8BEC7' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2F7' } };

function describeVacations(config) {
  const periods = [];
  if (Array.isArray(config.vacations)) {
    for (const period of config.vacations) {
      if (!period?.from && !period?.to) continue;
      periods.push(`${formatMaybeDate(period.from)} — ${formatMaybeDate(period.to)}`);
    }
  }
  if (periods.length === 0 && config.vacation?.enabled) {
    periods.push(`${formatMaybeDate(config.vacation.from)} — ${formatMaybeDate(config.vacation.to)}`);
  }
  return periods.length > 0 ? periods.join('; ') : 'нет';
}

function describeSettings(settings, year) {
  const config = settings || {};
  const accepting =
    (config.acceptingDays || []).map((day) => WEEKDAYS[day]).filter(Boolean).join(', ') || '—';
  const vacation = describeVacations(config);
  const lunch =
    config.lunch?.enabled === false
      ? 'нет'
      : `${config.lunch?.start || '12:00'}–${config.lunch?.end || '13:00'}`;
  const threshold =
    Number.isFinite(Number(config.physicalThreshold)) && Number(config.physicalThreshold) >= 0
      ? Math.floor(Number(config.physicalThreshold))
      : 3;
  const physical =
    config.smallPhysicalMode === 'B'
      ? 'вариант Б (примечание, приём в приёмные дни)'
      : 'вариант А (исключить)';
  const winterPercent = Number.isFinite(Number(config.winterLoadPercent))
    ? Math.min(100, Math.max(0, Number(config.winterLoadPercent)))
    : 30;
  return [
    ['Целевой год', year],
    ['Глубина давности ТО, лет', config.toDepthYears ?? 3],
    ['Окно группировки, дней', config.groupWindowDays ?? 30],
    ['Приёмные дни недели', accepting],
    ['Отпуск инспектора', vacation],
    ['Рабочий день', `${config.workStart || '09:00'}–${config.workEnd || '18:00'}`],
    ['Обед', lunch],
    ['Машин в час на площадке', config.perHour ?? 12],
    ['Переезд между локациями, мин', config.travelMinutes ?? 60],
    ['Порог физлиц, ед. техники', threshold],
    [`Физлица с ≤${threshold} ед. техники`, physical],
    [
      'Группировать малых владельцев по последней дате ТО',
      config.groupSmallOwners !== false ? `да (≤${threshold} ед.)` : 'нет',
    ],
    ['Адрес инспекции', config.inspectionAddress || '—'],
    ['Зимние месяцы', winterLabel(config)],
    ['Загрузка зимних месяцев, %', winterPercent],
  ];
}

function styleSheet(worksheet) {
  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = BORDER;
      if (!cell.alignment) cell.alignment = { vertical: 'top', wrapText: true };
    });
  });
  const header = worksheet.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });
}

function autoWidth(worksheet) {
  worksheet.columns.forEach((column, index) => {
    let max = String(column.header ?? '').length;
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const value = row.getCell(index + 1).value;
      const text = value == null ? '' : String(value);
      const longest = Math.max(...text.split('\n').map((line) => line.length));
      if (longest > max) max = longest;
    });
    column.width = Math.min(Math.max(10, max + 2), 48);
  });
}

function finalize(worksheet) {
  styleSheet(worksheet);
  autoWidth(worksheet);
  if (worksheet.rowCount > 0) {
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
}

function buildScheduleSheet(workbook, result) {
  const sheet = workbook.addWorksheet('График ТО');
  sheet.columns = [
    { header: '№ п/п', width: 8 },
    { header: 'Наименование поселения (хозяйства, предприятия)', width: 40 },
    { header: 'Дата проведения', width: 16 },
    { header: 'Время проведения', width: 16 },
  ];
  result.visits.forEach((visit, index) => {
    sheet.addRow([index + 1, visit.owner, formatDate(visit.date), formatTimeLabel(visit.startMin)]);
  });
  if (result.notes && result.notes.length > 0) {
    sheet.addRow([]);
    const noteRow = sheet.addRow([result.notes.join(' ')]);
    sheet.mergeCells(noteRow.number, 1, noteRow.number, 4);
    noteRow.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    noteRow.getCell(1).font = { italic: true };
  }
  finalize(sheet);
}

function buildDetailsSheet(workbook, result) {
  const sheet = workbook.addWorksheet('Детализация');
  sheet.columns = [
    { header: '№ п/п', width: 8 },
    { header: 'Дата', width: 12 },
    { header: 'Время (с–до)', width: 18 },
    { header: 'Владелец', width: 30 },
    { header: 'ИНН', width: 14 },
    { header: 'Адрес', width: 30 },
    { header: 'Локация (ключ)', width: 22 },
    { header: 'Кол-во техники', width: 12 },
    { header: 'Длительность, мин', width: 12 },
    { header: 'Гос. знаки / марки', width: 36 },
    { header: 'Источник даты', width: 26 },
    { header: 'Просроченная', width: 12 },
    { header: 'Перегруз', width: 10 },
    { header: 'Единицы и исходные целевые даты', width: 48 },
  ];
  result.visits.forEach((visit, index) => {
    const row = sheet.addRow([
      index + 1,
      formatDate(visit.date),
      formatTimeRange(visit.startMin, visit.endMin),
      visit.owner,
      visit.inn,
      visit.address,
      visit.locationKey,
      visit.units,
      visit.durationMin,
      formatVehicleList(visit.records),
      (visit.sources || []).join('; '),
      visit.overdue ? 'да' : '',
      visit.overload ? 'да' : '',
      formatUnitTargets(visit.unitsDetail),
    ]);
    row.getCell(10).alignment = { vertical: 'top', wrapText: true };
    row.getCell(14).alignment = { vertical: 'top', wrapText: true };
  });
  finalize(sheet);
}

function buildExcludedSheet(workbook, result) {
  const sheet = workbook.addWorksheet('Исключенные записи');
  sheet.columns = [
    { header: 'Владелец', width: 30 },
    { header: 'ИНН', width: 14 },
    { header: 'Гос. рег. знак', width: 16 },
    { header: 'Марка', width: 16 },
    { header: 'Наименование', width: 18 },
    { header: 'Зав. №', width: 12 },
    { header: 'Категория', width: 10 },
    { header: 'Дата ТО', width: 12 },
    { header: 'Причина исключения', width: 34 },
  ];
  result.excluded.forEach((entry) => {
    const record = entry.record || {};
    sheet.addRow([
      record.owner || '',
      record.inn || '',
      record.plate || '',
      record.brand || '',
      record.name || '',
      record.serial || '',
      record.category || '',
      formatDate(record.lastTo),
      entry.reason || '',
    ]);
  });
  finalize(sheet);
}

function buildSummarySheet(workbook, result, settings) {
  const sheet = workbook.addWorksheet('Сводка и нагрузка');
  sheet.columns = [
    { header: 'Месяц', width: 16 },
    { header: 'Выездов', width: 10 },
    { header: 'Машин', width: 10 },
  ];
  result.summary.months.forEach((month) => {
    sheet.addRow([MONTHS[month.month - 1], month.visits, month.machines]);
  });
  sheet.addRow(['Итого', result.summary.visits, result.summary.machines]);

  sheet.addRow([]);
  const settingsTitle = sheet.addRow(['Применённые настройки']);
  describeSettings(settings, result.year).forEach(([label, value]) => {
    sheet.addRow([label, value]);
  });

  finalize(sheet);
  settingsTitle.font = { bold: true };
}

// Returns the .xlsx as an ArrayBuffer/Buffer, ready to download or load in tests.
export async function exportScheduleToXlsx(result, settings = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'График ТО';
  workbook.created = new Date();

  buildScheduleSheet(workbook, result);
  buildDetailsSheet(workbook, result);
  buildExcludedSheet(workbook, result);
  buildSummarySheet(workbook, result, settings);

  return workbook.xlsx.writeBuffer();
}
