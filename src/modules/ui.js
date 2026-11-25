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
    vacations: [],
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
const BLOCKS_STORAGE_KEY = 'grafik-to-blocks-v1';

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
    if (Array.isArray(data.vacations)) {
      result.vacations = data.vacations
        .map((period) => ({
          from: typeof period?.from === 'string' ? period.from : '',
          to: typeof period?.to === 'string' ? period.to : '',
        }))
        .filter((period) => period.from || period.to);
    }
    return result;
  } catch {
    return {};
  }
}

function loadPersistedBlocks() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return {};
    const raw = storage.getItem(BLOCKS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function persistBlocks(blocks) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    storage.setItem(BLOCKS_STORAGE_KEY, JSON.stringify(blocks));
  } catch {
    // Ignore quota/private-mode errors.
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
        vacations: settings.vacations,
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

function updateBlockHints(root, settings) {
  const hints = {
    filter: `${settings.toDepthYears} г., окно ${settings.groupWindowDays} дн.`,
    workday: `${settings.workStart}–${settings.workEnd}, ${settings.perHour} маш/ч`,
    winter: `${winterMonthsLabel(settings.winterMonths)}, ${settings.winterLoadPercent} %`,
    physical: `порог ${settings.physicalThreshold}, режим ${settings.smallPhysicalMode}`,
  };
  for (const [key, text] of Object.entries(hints)) {
    const hintEl = root.getElementById(`hint-${key}`);
    if (hintEl) hintEl.textContent = text;
  }
}

export function winterMonthsLabel(months) {
  const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  if (!months || months.length === 0) return 'нет';
  if (months.length === 12) return 'все';
  const sorted = [...months].sort((a, b) => a - b);
  // Check for wrap-around consecutive case (e.g., Dec, Jan, Feb = 11, 0, 1)
  // Try to find a rotation that makes it consecutive
  for (let shift = 0; shift < sorted.length; shift++) {
    const rotated = [...sorted.slice(shift), ...sorted.slice(0, shift).map((m) => m + 12)];
    let consecutive = true;
    for (let i = 1; i < rotated.length; i++) {
      if (rotated[i] - rotated[i - 1] !== 1) {
        consecutive = false;
        break;
      }
    }
    if (consecutive) {
      const first = rotated[0] % 12;
      const last = rotated[rotated.length - 1] % 12;
      return `${names[first]}–${names[last]}`;
    }
  }
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (last - first === sorted.length - 1) {
    return `${names[first]}–${names[last]}`;
  }
  return sorted.map((m) => names[m]).join(', ');
}

function setupBlockListeners(root) {
  const blocks = root.querySelectorAll('.settings-block');
  const persisted = loadPersistedBlocks();

  // Restore open state
  for (const block of blocks) {
    const key = block.dataset.storageKey;
    if (key && persisted[key] === true) {
      block.open = true;
    }
    block.addEventListener('toggle', () => {
      const k = block.dataset.storageKey;
      if (k) {
        const updated = { ...persisted, [k]: block.open };
        persistBlocks(updated);
      }
    });
  }

  // Update hints on input change
  const inputs = root.querySelectorAll(
    '#toDepthYears, #groupWindowDays, #workStart, #workEnd, #perHour, #travelMinutes, ' +
    'input[name="winterMonth"], #winterLoadPercent, #physicalThreshold, input[name="smallPhysical"], #groupSmallOwners'
  );
  for (const input of inputs) {
    input.addEventListener('change', () => {
      const current = readSettings(root, defaultSettings());
      updateBlockHints(root, current);
    });
    input.addEventListener('input', () => {
      const current = readSettings(root, defaultSettings());
      updateBlockHints(root, current);
    });
  }
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

export function detailPreviewRows(result, settings = {}) {
  const exportDate = settings.exportDate instanceof Date && !Number.isNaN(settings.exportDate.getTime())
    ? settings.exportDate
    : new Date();
  return (result.visits || []).map((visit, index) => [
    index + 1,
    formatDate(visit.date),
    formatTimeRange(visit.startMin, visit.endMin),
    visit.owner,
    visit.inn,
    visit.locationLabel,
    visit.units,
    visit.inspectionMin ?? visit.durationMin,
    visit.travelMin ?? 0,
    formatVehicleList(visit.records),
    formatUnitTargets(visit.unitsDetail, { exportDate }),
  ]);
}

function renderResults(root, result, settings = {}) {
  const schedule = root.querySelector('[data-panel="schedule"]');
  const details = root.querySelector('[data-panel="details"]');
  const excluded = root.querySelector('[data-panel="excluded"]');
  const summary = root.querySelector('[data-panel="summary"]');

  if (schedule) {
    schedule.replaceChildren(
      result.visits.length === 0
        ? placeholderPanel('Нет визитов для показа.')
        : makeTable(
            ['№ п/п', 'Владелец', 'Дата', 'Время'],
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
              '№ п/п',
              'Дата',
              'Время',
              'Владелец',
              'ИНН',
              'Локация',
              'Техники',
              'Осмотр, мин',
              'Переезд, мин',
              'Знаки / марки',
              'Единицы и целевая дата ТО',
            ],
            detailPreviewRows(result, settings),
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
  const winterMonths = [...root.querySelectorAll('input[name="winterMonth"]:checked')].map(
    (input) => Number(input.value),
  );
  const vacations = [...root.querySelectorAll('#vacationList .vacation-row')]
    .map((row) => ({
      from: row.querySelector('input[data-role="vacation-from"]')?.value || '',
      to: row.querySelector('input[data-role="vacation-to"]')?.value || '',
    }))
    .filter((period) => period.from || period.to);
  const winterPercentRaw = value('winterLoadPercent');
  const winterPercent = Number(winterPercentRaw);
  const perHourRaw = Number(value('perHour'));
  const groupWindowRaw = Number(value('groupWindowDays'));
  return {
    ...base,
    targetYear: Number(value('targetYear')) || base.targetYear,
    acceptingDays,
    vacations,
    toDepthYears: Number(value('toDepthYears')) || base.toDepthYears,
    groupWindowDays:
      Number.isFinite(groupWindowRaw) && groupWindowRaw >= 1
        ? Math.min(365, Math.max(1, Math.floor(groupWindowRaw)))
        : base.groupWindowDays,
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
    perHour:
      Number.isFinite(perHourRaw) && perHourRaw > 0
        ? Math.min(100, Math.max(1, Math.round(perHourRaw)))
        : base.perHour,
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
    const summary = `${file.name}: ${parsed.records.length} строк`;
    els.fileInfo.textContent = summary;
    if (els.fileBarInfo) els.fileBarInfo.textContent = summary;
    if (els.dropZone) els.dropZone.hidden = true;
    if (els.fileBar) els.fileBar.hidden = false;
    els.analyzeButton.disabled = parsed.records.length === 0;
    els.downloadButton.disabled = true;
    clearMessages(root);
    setStatus(
      root,
      `Загружено ${parsed.records.length} строк. Нажмите «Сформировать график».`,
    );
  } catch (error) {
    state.records = [];
    if (els.dropZone) els.dropZone.hidden = false;
    if (els.fileBar) els.fileBar.hidden = true;
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
  renderResults(root, result, settings);
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

function addVacationRow(container, period = {}) {
  if (!container) return;
  const row = element('div', 'vacation-row');
  const from = document.createElement('input');
  from.type = 'date';
  from.dataset.role = 'vacation-from';
  from.setAttribute('aria-label', 'Отпуск с');
  from.value = period.from || '';
  const dash = element('span', '', '—');
  const to = document.createElement('input');
  to.type = 'date';
  to.dataset.role = 'vacation-to';
  to.setAttribute('aria-label', 'Отпуск по');
  to.value = period.to || '';
  const remove = element('button', 'button vacation-remove', '×');
  remove.type = 'button';
  remove.setAttribute('aria-label', 'Удалить период отпуска');
  remove.addEventListener('click', () => row.remove());
  row.append(from, dash, to, remove);
  container.append(row);
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
    fileBar: root.getElementById('file-bar'),
    fileBarInfo: root.getElementById('fileBarInfo'),
    reloadFileButton: root.getElementById('reloadFileButton'),
    vacationList: root.getElementById('vacationList'),
    addVacationButton: root.getElementById('addVacationButton'),
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
  const winterCheckboxes = root.querySelectorAll('input[name="winterMonth"]');
  if (winterCheckboxes.length > 0) {
    const selected = new Set(state.settings.winterMonths.map(Number));
    for (const checkbox of winterCheckboxes) {
      checkbox.checked = selected.has(Number(checkbox.value));
    }
  }

  const vacations = Array.isArray(state.settings.vacations) ? state.settings.vacations : [];
  if (vacations.length === 0) addVacationRow(els.vacationList);
  else for (const period of vacations) addVacationRow(els.vacationList, period);
  els.addVacationButton?.addEventListener('click', () => addVacationRow(els.vacationList));

  const syncLunch = () => {
    const enabled = Boolean(els.lunchEnabled?.checked);
    if (els.lunchStart) els.lunchStart.disabled = !enabled;
    if (els.lunchEnd) els.lunchEnd.disabled = !enabled;
  };
  els.lunchEnabled?.addEventListener('change', syncLunch);
  syncLunch();

  // GRAFIK-31: update live hints in block summaries and persist open state
  updateBlockHints(root, state.settings);
  setupBlockListeners(root);

  els.chooseFileButton?.addEventListener('click', () => els.fileInput?.click());
  els.reloadFileButton?.addEventListener('click', () => els.fileInput?.click());
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
