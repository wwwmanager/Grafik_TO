// Wires the app: settings panel, drag-and-drop upload, calendar lookup,
// schedule computation, preview tabs and .xlsx download.
import { loadProductionCalendar } from './calendarService.js';
import {
  formatDate,
  formatTimeLabel,
  formatTimeRange,
  formatUnitTargets,
  formatVehicleList,
} from './format.js';
import { buildSchedule } from './scheduler.js';

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

export function defaultSettings(now = new Date()) {
  return {
    targetYear: now.getFullYear() + 1,
    acceptingDays: [],
    vacation: { enabled: false, from: null, to: null },
    toDepthYears: 3,
    groupWindowDays: 30,
    smallPhysicalMode: 'A',
    physicalThreshold: 3,
    groupSmallOwners: true,
    inspectionAddress: '',
    workStart: '09:00',
    workEnd: '18:00',
    lunch: { enabled: true, start: '12:00', end: '13:00' },
    perHour: 12,
    travelMinutes: 60,
    winterMonths: [11, 0, 1],
    winterLoadPercent: 30,
  };
}

// D11/D14: persist the new fields across reloads (localStorage may be absent in tests).
const STORAGE_KEY = 'grafik-to-settings-v1';

export function loadPersistedSettings() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return {};
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) || {};
    const result = {};
    const threshold = Number(data.physicalThreshold);
    if (Number.isFinite(threshold) && threshold >= 0) result.physicalThreshold = threshold;
    if (typeof data.groupSmallOwners === 'boolean') result.groupSmallOwners = data.groupSmallOwners;
    const percent = Number(data.winterLoadPercent);
    if (Number.isFinite(percent)) result.winterLoadPercent = Math.min(100, Math.max(0, percent));
    if (Array.isArray(data.winterMonths)) {
      const months = data.winterMonths
        .map((month) => Number(month))
        .filter((month) => Number.isInteger(month) && month >= 0 && month <= 11);
      result.winterMonths = [...new Set(months)];
    }
    return result;
  } catch {
    return {};
  }
}

function persistSettings(settings) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        physicalThreshold: settings.physicalThreshold,
        groupSmallOwners: settings.groupSmallOwners,
        winterMonths: settings.winterMonths,
        winterLoadPercent: settings.winterLoadPercent,
      }),
    );
  } catch {
    // Ignore quota/private-mode errors; persistence is a convenience only.
  }
}

export function summarizeMessages(result) {
  const messages = [];
  for (const warning of result.warnings || []) messages.push({ type: 'warning', text: warning });
  for (const note of result.notes || []) messages.push({ type: 'note', text: note });
  if ((result.excluded || []).length > 0) {
    messages.push({ type: 'info', text: `Исключено записей: ${result.excluded.length}.` });
  }
  return messages;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function makeTable(headers, rows) {
  const table = element('table', 'data-table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const header of headers) {
    const cell = document.createElement('th');
    cell.textContent = header;
    headRow.appendChild(cell);
  }
  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const value of row) {
      const cell = document.createElement('td');
      cell.textContent = value === undefined || value === null ? '' : String(value);
      tr.appendChild(cell);
    }
    body.appendChild(tr);
  }
  table.appendChild(body);
  return table;
}

function placeholderPanel(text) {
  return element('p', 'placeholder', text);
}

function setStatus(root, text) {
  const status = root.getElementById('status-line');
  if (status) status.textContent = text;
}

function renderMessages(root, messages) {
  const container = root.getElementById('messages');
  if (!container) return;
  container.replaceChildren();
  for (const message of messages) {
    container.appendChild(element('div', `message message-${message.type}`, message.text));
  }
}

function clearMessages(root) {
  const container = root.getElementById('messages');
  if (container) container.replaceChildren();
}

function showError(root, text) {
  renderMessages(root, [{ type: 'error', text }]);
  setStatus(root, text);
}

// Rows for the preview tables. The schedule tab shows only the owner name — all
// extra state (overdue, «Без ТО», …) belongs to the details tab.
export function schedulePreviewRows(result) {
  return (result.visits || []).map((visit, index) => [
    index + 1,
    visit.owner,
    formatDate(visit.date),
    formatTimeLabel(visit.startMin),
  ]);
}

export function detailPreviewRows(result) {
  return (result.visits || []).map((visit) => [
    formatDate(visit.date),
    formatTimeRange(visit.startMin, visit.endMin),
    visit.owner,
    visit.inn,
    visit.locationLabel,
    visit.units,
    visit.durationMin,
    formatVehicleList(visit.records),
    formatUnitTargets(visit.unitsDetail),
  ]);
}

function renderResults(root, result) {
  const schedule = root.querySelector('[data-panel="schedule"]');
  const details = root.querySelector('[data-panel="details"]');
  const excluded = root.querySelector('[data-panel="excluded"]');
  const summary = root.querySelector('[data-panel="summary"]');

  if (schedule) {
    schedule.replaceChildren(
      result.visits.length === 0
        ? placeholderPanel('Нет визитов для показа.')
        : makeTable(
            ['№', 'Владелец', 'Дата', 'Время'],
            schedulePreviewRows(result),
          ),
    );
  }

  if (details) {
    details.replaceChildren(
      result.visits.length === 0
        ? placeholderPanel('Нет визитов для показа.')
        : makeTable(
            [
              'Дата',
              'Время',
              'Владелец',
              'ИНН',
              'Локация',
              'Техники',
              'Длительность, мин',
              'Знаки / марки',
              'Единицы и исходные даты',
            ],
            detailPreviewRows(result),
          ),
    );
  }

  if (excluded) {
    excluded.replaceChildren(
      result.excluded.length === 0
        ? placeholderPanel('Исключенных записей нет.')
        : makeTable(
            ['Владелец', 'Гос. знак', 'Марка', 'Причина исключения'],
            result.excluded.map((entry) => [
              entry.record?.owner || '',
              entry.record?.plate || '',
              entry.record?.brand || '',
              entry.reason || '',
            ]),
          ),
    );
  }

  if (summary) {
    summary.replaceChildren(
      makeTable(
        ['Месяц', 'Выездов', 'Машин'],
        result.summary.months.map((month) => [
          MONTHS[month.month - 1],
          month.visits,
          month.machines,
        ]),
      ),
    );
  }
}

function readSettings(root, base) {
  const value = (id) => {
    const input = root.getElementById(id);
    return input ? input.value : '';
  };
  const checked = (id) => {
    const input = root.getElementById(id);
    return input ? input.checked : false;
  };
  const acceptingDays = [...root.querySelectorAll('input[name="acceptingDay"]:checked')].map(
    (input) => Number(input.value),
  );
  const physical = root.querySelector('input[name="smallPhysical"]:checked');
  const travel = value('travelMinutes');
  const thresholdRaw = Number(value('physicalThreshold'));
  const winterSelect = root.getElementById('winterMonths');
  const winterMonths = winterSelect
    ? [...winterSelect.selectedOptions].map((option) => Number(option.value))
    : base.winterMonths;
  const winterPercentRaw = value('winterLoadPercent');
  const winterPercent = Number(winterPercentRaw);
  return {
    ...base,
    targetYear: Number(value('targetYear')) || base.targetYear,
    acceptingDays,
    vacation: {
      enabled: checked('vacationEnabled'),
      from: value('vacationFrom') || null,
      to: value('vacationTo') || null,
    },
    toDepthYears: Number(value('toDepthYears')) || base.toDepthYears,
    groupWindowDays: Number(value('groupWindowDays')) || base.groupWindowDays,
    smallPhysicalMode: physical ? physical.value : base.smallPhysicalMode,
    physicalThreshold:
      Number.isFinite(thresholdRaw) && thresholdRaw >= 0
        ? Math.floor(thresholdRaw)
        : base.physicalThreshold,
    groupSmallOwners: root.getElementById('groupSmallOwners')
      ? checked('groupSmallOwners')
      : base.groupSmallOwners,
    inspectionAddress: value('inspectionAddress').trim(),
    workStart: value('workStart') || base.workStart,
    workEnd: value('workEnd') || base.workEnd,
    lunch: {
      enabled: checked('lunchEnabled'),
      start: value('lunchStart') || base.lunch.start,
      end: value('lunchEnd') || base.lunch.end,
    },
    perHour: Number(value('perHour')) || base.perHour,
    travelMinutes: travel === '' ? base.travelMinutes : Number(travel),
    winterMonths,
    winterLoadPercent:
      winterPercentRaw === ''
        ? base.winterLoadPercent
        : Math.min(100, Math.max(0, Number.isFinite(winterPercent) ? winterPercent : base.winterLoadPercent)),
  };
}

async function handleFile(file, state, els, root) {
  if (!file) return;
  setStatus(root, 'Чтение файла…');
  try {
    const buffer = await file.arrayBuffer();
    const { parseWorkbook } = await import('./parser.js');
    const parsed = parseWorkbook(new Uint8Array(buffer));
    state.records = parsed.records;
    state.fileName = file.name;
    state.exportDate = parsed.exportDate || null;
    els.fileInfo.textContent = `${file.name}: ${parsed.records.length} строк`;
    els.analyzeButton.disabled = parsed.records.length === 0;
    els.downloadButton.disabled = true;
    clearMessages(root);
    setStatus(
      root,
      `Загружено ${parsed.records.length} строк. Нажмите «Сформировать график».`,
    );
  } catch (error) {
    state.records = [];
    els.analyzeButton.disabled = true;
    showError(root, error?.message || 'Не удалось прочитать файл.');
  }
}

async function analyze(state, els, root) {
  if (state.records.length === 0) {
    showError(root, 'Сначала загрузите файл Excel.');
    return;
  }
  const settings = { ...readSettings(root, defaultSettings()), exportDate: state.exportDate };
  persistSettings(settings);
  setStatus(root, 'Загрузка производственного календаря…');
  let calendar = null;
  try {
    calendar = await loadProductionCalendar(settings.targetYear);
  } catch {
    // Keep the null calendar; the scheduler then falls back to weekends.
  }
  const result = buildSchedule(state.records, settings, calendar);
  state.result = result;
  state.settings = settings;
  renderResults(root, result);
  renderMessages(root, summarizeMessages(result));
  els.downloadButton.disabled = result.visits.length === 0;
  setStatus(
    root,
    `Готово: визитов ${result.summary.visits}, машин ${result.summary.machines}, исключено ${result.excluded.length}.`,
  );
}

async function download(state, els, root) {
  if (!state.result) return;
  els.downloadButton.disabled = true;
  setStatus(root, 'Формирование Excel…');
  try {
    const { exportScheduleToXlsx } = await import('./exporter.js');
    const buffer = await exportScheduleToXlsx(state.result, state.settings);
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `grafik-TO-${state.settings.targetYear}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(root, 'Файл сформирован.');
  } catch (error) {
    showError(root, error?.message || 'Не удалось сформировать файл.');
  } finally {
    els.downloadButton.disabled = false;
  }
}

export function initUi(root = document) {
  const state = {
    records: [],
    result: null,
    settings: { ...defaultSettings(), ...loadPersistedSettings() },
    fileName: '',
  };
  const els = {
    fileInfo: root.getElementById('fileInfo'),
    fileInput: root.getElementById('fileInput'),
    chooseFileButton: root.getElementById('chooseFileButton'),
    analyzeButton: root.getElementById('analyzeButton'),
    downloadButton: root.getElementById('downloadButton'),
    dropZone: root.getElementById('drop-zone'),
    vacationEnabled: root.getElementById('vacationEnabled'),
    vacationFrom: root.getElementById('vacationFrom'),
    vacationTo: root.getElementById('vacationTo'),
    lunchEnabled: root.getElementById('lunchEnabled'),
    lunchStart: root.getElementById('lunchStart'),
    lunchEnd: root.getElementById('lunchEnd'),
  };

  const targetYear = root.getElementById('targetYear');
  if (targetYear) targetYear.value = String(state.settings.targetYear);

  const thresholdInput = root.getElementById('physicalThreshold');
  if (thresholdInput) thresholdInput.value = String(state.settings.physicalThreshold);
  const groupSmallInput = root.getElementById('groupSmallOwners');
  if (groupSmallInput) groupSmallInput.checked = state.settings.groupSmallOwners !== false;
  const winterPercentInput = root.getElementById('winterLoadPercent');
  if (winterPercentInput) winterPercentInput.value = String(state.settings.winterLoadPercent);
  const winterSelect = root.getElementById('winterMonths');
  if (winterSelect) {
    const selected = new Set(state.settings.winterMonths.map(Number));
    for (const option of winterSelect.options) {
      option.selected = selected.has(Number(option.value));
    }
  }

  const syncVacation = () => {
    const enabled = Boolean(els.vacationEnabled?.checked);
    if (els.vacationFrom) els.vacationFrom.disabled = !enabled;
    if (els.vacationTo) els.vacationTo.disabled = !enabled;
  };
  els.vacationEnabled?.addEventListener('change', syncVacation);
  syncVacation();

  const syncLunch = () => {
    const enabled = Boolean(els.lunchEnabled?.checked);
    if (els.lunchStart) els.lunchStart.disabled = !enabled;
    if (els.lunchEnd) els.lunchEnd.disabled = !enabled;
  };
  els.lunchEnabled?.addEventListener('change', syncLunch);
  syncLunch();

  els.chooseFileButton?.addEventListener('click', () => els.fileInput?.click());
  els.fileInput?.addEventListener('change', () => {
    handleFile(els.fileInput.files?.[0], state, els, root);
  });

  if (els.dropZone) {
    els.dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      els.dropZone.classList.add('is-dragover');
    });
    els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('is-dragover'));
    els.dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      els.dropZone.classList.remove('is-dragover');
      handleFile(event.dataTransfer?.files?.[0], state, els, root);
    });
  }

  els.analyzeButton?.addEventListener('click', () => analyze(state, els, root));
  els.downloadButton?.addEventListener('click', () => download(state, els, root));

  const tabs = root.querySelectorAll('.tab');
  const panels = root.querySelectorAll('.tab-panel');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      tabs.forEach((other) => other.classList.toggle('is-active', other === tab));
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.panel !== name;
      });
    });
  });
}
