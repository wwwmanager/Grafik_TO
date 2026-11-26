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
import {
  renderPhysicalTab,
  buildPhysicalTree,
  rebuildScheduleWithDecisions,
  computeFingerprint,
  loadPhysicalDecisions,
  savePhysicalDecisions,
  clearPhysicalDecisions,
} from './physicalTab.js';
import {
  RETRY_LABEL,
  clearImportError,
  loadModule,
  renderImportError,
} from './resilience.js';

// GRAFIK-44: set while the region UI is live; refreshes the auto base label
// when a new export is parsed (records -> resolved addresses -> mode).
let refreshBaseSettlementForUi = null;

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
    // Physical schedule (GRAFIK-34)
    includePhysical: false,
    physicalScope: 'threshold', // 'threshold' | 'all'
    minUnitsForVisit: 5,
    baseSettlement: null,
    maxRadiusKm: 40,
    avgSpeedKmh: 50,
    onsiteDays: [],
    onsiteAsAcceptingDays: true,
    onsiteLocation: 'inspection', // 'inspection' | 'own'
    onsiteAddress: '',
    // Region selection for address resolver (GRAFIK-33/34)
    inspectionRegion: null,
    neighboringRegions: [],
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
    // Physical settings (GRAFIK-34)
    if (typeof data.includePhysical === 'boolean') result.includePhysical = data.includePhysical;
    if (typeof data.physicalScope === 'string') result.physicalScope = data.physicalScope;
    const minUnits = Number(data.minUnitsForVisit);
    if (Number.isFinite(minUnits) && minUnits >= 1) result.minUnitsForVisit = minUnits;
    if (data.baseSettlement) result.baseSettlement = data.baseSettlement;
    const maxRadius = Number(data.maxRadiusKm);
    if (Number.isFinite(maxRadius) && maxRadius >= 1) result.maxRadiusKm = maxRadius;
    const avgSpeed = Number(data.avgSpeedKmh);
    if (Number.isFinite(avgSpeed) && avgSpeed >= 1) result.avgSpeedKmh = avgSpeed;
    if (Array.isArray(data.onsiteDays)) {
      result.onsiteDays = data.onsiteDays.map(d => Number(d)).filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
    }
    if (typeof data.onsiteAsAcceptingDays === 'boolean') result.onsiteAsAcceptingDays = data.onsiteAsAcceptingDays;
    if (typeof data.onsiteLocation === 'string') result.onsiteLocation = data.onsiteLocation;
    if (typeof data.onsiteAddress === 'string') result.onsiteAddress = data.onsiteAddress;
    // Region selection
    const inspectionRegion = Number(data.inspectionRegion);
    if (Number.isFinite(inspectionRegion)) result.inspectionRegion = inspectionRegion;
    if (Array.isArray(data.neighboringRegions)) {
      result.neighboringRegions = data.neighboringRegions.map(r => Number(r)).filter(r => Number.isFinite(r));
    }
    return result;
  } catch {
    return {};
  }
}

// GRAFIK-42: the two physical accordions were merged into one section.
// Migrate the old per-accordion open-state keys without losing state:
// if either old block was open, the merged block opens.
const LEGACY_BLOCK_KEYS = {
  'open-physical-schedule': 'open-physical',
};

export function migrateBlockState(blocks) {
  if (!blocks || typeof blocks !== 'object' || Array.isArray(blocks)) return {};
  const result = { ...blocks };
  for (const [legacy, canonical] of Object.entries(LEGACY_BLOCK_KEYS)) {
    if (!(legacy in result)) continue;
    const legacyOpen = result[legacy] === true;
    delete result[legacy];
    if (legacyOpen) result[canonical] = true;
  }
  return result;
}

function loadPersistedBlocks() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return {};
    const raw = storage.getItem(BLOCKS_STORAGE_KEY);
    if (!raw) return {};
    return migrateBlockState(JSON.parse(raw) || {});
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
        includePhysical: settings.includePhysical,
        physicalScope: settings.physicalScope,
        minUnitsForVisit: settings.minUnitsForVisit,
        baseSettlement: settings.baseSettlement,
        maxRadiusKm: settings.maxRadiusKm,
        avgSpeedKmh: settings.avgSpeedKmh,
        onsiteDays: settings.onsiteDays,
        onsiteAsAcceptingDays: settings.onsiteAsAcceptingDays,
        onsiteLocation: settings.onsiteLocation,
        onsiteAddress: settings.onsiteAddress,
        inspectionRegion: settings.inspectionRegion,
        neighboringRegions: settings.neighboringRegions,
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
    filter: `${settings.toDepthYears} г. / окно ${settings.groupWindowDays} дн.`,
    workday: `${settings.workStart}–${settings.workEnd}, ${settings.perHour} маш/ч`,
    winter: `${winterMonthsLabel(settings.winterMonths)}, ${settings.winterLoadPercent} %`,
    physical: `порог ${settings.physicalThreshold} · ${settings.includePhysical ? 'вкл' : 'выкл'}`,
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

  for (const block of blocks) {
    const key = block.dataset.storageKey;
    const summary = block.querySelector('summary');
    const content = block.querySelector('.settings-block-content');
    if (content && !content.id) content.id = `${block.id}-content`;
    if (summary && content) summary.setAttribute('aria-controls', content.id);

    // Restore open state (old two-section physical keys are already migrated).
    if (key && persisted[key] === true) {
      block.open = true;
    }
    if (summary) summary.setAttribute('aria-expanded', String(block.open));

    block.addEventListener('toggle', () => {
      if (summary) summary.setAttribute('aria-expanded', String(block.open));
      const k = block.dataset.storageKey;
      if (k) {
        // Re-read so toggling one block never drops another block's state.
        const updated = { ...loadPersistedBlocks(), [k]: block.open };
        persistBlocks(updated);
      }
    });
  }

  // Update hints on input change
  const inputs = root.querySelectorAll(
    '#toDepthYears, #groupWindowDays, #workStart, #workEnd, #perHour, #travelMinutes, ' +
    'input[name="winterMonth"], #winterLoadPercent, #physicalThreshold, input[name="smallPhysical"], #groupSmallOwners, ' +
    '#includePhysical, #physicalScope, #minUnitsForVisit, #maxRadiusKm, #avgSpeedKmh, ' +
    'input[name="onsiteDay"], #onsiteAsAcceptingDays, input[name="onsiteLocation"], #onsiteAddress, ' +
    '#inspectionRegion, input[name="neighboringRegion"], #neighboringRegionsSearch'
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

function messagesContainer(root) {
  return root.getElementById('messages');
}

// GRAFIK-43: shown when a region's settlement reference is unavailable; the
// textual address grouping keeps working, so this is a hint, not an error.
export const REGION_NO_DATA_HINT =
  'Гео-справочник для региона не загружен — используется текстовая группировка по адресам';
const REGION_HINT_ID = 'region-no-data-hint';

function showRegionNoDataHint(root) {
  const host = messagesContainer(root);
  if (!host) return;
  if (typeof host.querySelector === 'function' && host.querySelector(`#${REGION_HINT_ID}`)) return;
  const hint = element('div', 'message message-warning', REGION_NO_DATA_HINT);
  hint.id = REGION_HINT_ID;
  hint.setAttribute('role', 'status');
  if (typeof host.prepend === 'function') host.prepend(hint);
  else host.appendChild(hint);
}

function clearRegionNoDataHint(root) {
  const host = messagesContainer(root);
  if (!host || typeof host.querySelector !== 'function') return;
  const hint = host.querySelector(`#${REGION_HINT_ID}`);
  if (hint && typeof hint.remove === 'function') hint.remove();
}

// GRAFIK-47: the build reports processed/total so a long Челябинская export
// shows progress instead of looking frozen.
function asBaseSettlement(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return typeof value === 'object' ? value : null;
}

function physicalProgressText(progress) {
  if (!progress) return 'Построение маршрутов физлиц…';
  const { phase, processed, total } = progress;
  if (phase === 'months') return `Построение маршрутов физлиц… месяцы ${processed}/${total}`;
  if (phase === 'routes') return `Построение маршрутов физлиц… маршруты ${processed}/${total}`;
  return `Построение маршрутов физлиц… поселения ${processed}/${total}`;
}

// GRAFIK-46: an inline message with «Повторить» instead of a spinner that
// never ends. Used for chunk-load failures and other retryable work.
function showRetryableError(root, message, retry) {
  renderImportError(messagesContainer(root), {
    doc: root,
    message,
    retryLabel: RETRY_LABEL,
    onRetry: retry,
  });
  setStatus(root, `${message} Нажмите «${RETRY_LABEL}».`);
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
  
  // Physical settings (GRAFIK-34)
  const includePhysical = checked('includePhysical');
  const physicalScopeSelect = root.getElementById('physicalScope');
  const physicalScope = physicalScopeSelect ? physicalScopeSelect.value : base.physicalScope;
  const minUnitsRaw = Number(value('minUnitsForVisit'));
  const baseSettlementInput = root.getElementById('baseSettlement');
  // GRAFIK-44: the select stores JSON; the engine needs an object (or null).
  let baseSettlement = asBaseSettlement(base.baseSettlement);
  if (baseSettlementInput) {
    baseSettlement = asBaseSettlement(baseSettlementInput.value);
  }
  const maxRadiusRaw = Number(value('maxRadiusKm'));
  const avgSpeedRaw = Number(value('avgSpeedKmh'));
  const onsiteDays = [...root.querySelectorAll('input[name="onsiteDay"]:checked')].map(
    (input) => Number(input.value),
  );
  const onsiteAsAcceptingDays = checked('onsiteAsAcceptingDays');
  const onsiteLocation = root.querySelector('input[name="onsiteLocation"]:checked')?.value || base.onsiteLocation;
  const onsiteAddress = value('onsiteAddress').trim();
  
  // Region selection (GRAFIK-33/34)
  const inspectionRegionRaw = Number(value('inspectionRegion'));
  const inspectionRegion = Number.isFinite(inspectionRegionRaw) ? inspectionRegionRaw : base.inspectionRegion;
  const neighboringRegions = [...root.querySelectorAll('input[name="neighboringRegion"]:checked')].map(
    (input) => Number(input.value),
  );

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
    // Physical settings
    includePhysical,
    physicalScope,
    minUnitsForVisit: Number.isFinite(minUnitsRaw) && minUnitsRaw >= 1 ? minUnitsRaw : base.minUnitsForVisit,
    baseSettlement,
    maxRadiusKm: Number.isFinite(maxRadiusRaw) && maxRadiusRaw >= 1 ? maxRadiusRaw : base.maxRadiusKm,
    avgSpeedKmh: Number.isFinite(avgSpeedRaw) && avgSpeedRaw >= 1 ? avgSpeedRaw : base.avgSpeedKmh,
    onsiteDays,
    onsiteAsAcceptingDays,
    onsiteLocation,
    onsiteAddress,
    // Region selection
    inspectionRegion,
    neighboringRegions,
  };
}

async function handleFile(file, state, els, root) {
  if (!file) return;
  setStatus(root, 'Чтение файла…');
  let parseWorkbook;
  try {
    ({ parseWorkbook } = await loadModule(() => import('./parser.js'), {
      container: messagesContainer(root),
      doc: root,
      message: 'Не удалось загрузить модуль разбора файла.',
      onRetry: () => handleFile(file, state, els, root),
    }));
  } catch {
    // The inline error with «Повторить» is already rendered.
    state.records = [];
    els.analyzeButton.disabled = true;
    return;
  }
  try {
    clearImportError(messagesContainer(root));
    const buffer = await file.arrayBuffer();
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
    // GRAFIK-44: recompute the auto base settlement for the new export.
    refreshBaseSettlementForUi?.();
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
  let result = buildSchedule(state.records, settings, calendar);
  
  // GRAFIK-34/35: Build physical schedule if enabled
  const physicalTab = root.getElementById('physicalTab');
  const physicalTabPanel = root.getElementById('physicalTabPanel');
  
  if (settings.includePhysical) {
    setStatus(root, 'Построение маршрутов физлиц…');
    // GRAFIK-46: a failed chunk load or physical build must end in a visible
    // message with «Повторить», never in a permanent «Построение…» status.
    try {
    // Compute fingerprint for this export
    const fingerprint = computeFingerprint(state.fileName, state.exportDate, state.records.length);
    state.fingerprint = fingerprint;
    
    // Load saved decisions for this fingerprint
    const decisions = loadPhysicalDecisions(fingerprint) || {};
    state.physicalDecisions = decisions;
    
    // Build physical schedule with decisions applied
    const physical = await rebuildScheduleWithDecisions(
      state.records,
      settings,
      calendar,
      settings.targetYear,
      decisions,
      {
        deadlineMs: 15000,
        onProgress: (progress) => setStatus(root, physicalProgressText(progress)),
      },
    );
    
    const physicalVisits = [
      ...physical.outboundVisits.map(v => ({
        ...v,
        owner: v.routeName,
        locationKey: v.routeName,
        locationLabel: v.routeName,
        overdue: false,
        overload: false,
        isPhysical: true,
        isOutbound: true,
      })),
      ...physical.onsiteVisits.map(v => ({
        ...v,
        owner: `ТО физлиц на площадке: ${v.location === 'inspection' ? 'инспекция' : v.address}`,
        locationKey: v.location === 'inspection' ? 'инспекция' : v.address,
        locationLabel: v.location === 'inspection' ? 'инспекция' : v.address,
        overdue: false,
        overload: false,
        isPhysical: true,
        isOutbound: false,
      })),
    ];
    
    const allVisits = [...result.visits, ...physicalVisits].sort((a, b) => a.date - b.date || a.startMin - b.startMin);
    const allNotes = [...result.notes, ...physical.notes];
    
    const months = Array.from({ length: 12 }, (_, month) => ({
      month: month + 1,
      visits: 0,
      machines: 0,
    }));
    for (const visit of allVisits) {
      const entry = months[visit.date.getMonth()];
      entry.visits += 1;
      entry.machines += visit.units;
    }
    
    const machines = allVisits.reduce((sum, visit) => sum + visit.units, 0);
    const overloaded = allVisits.filter((visit) => visit.overload).length;
    
    result = {
      ...result,
      visits: allVisits,
      notes: allNotes,
      summary: {
        visits: allVisits.length,
        machines,
        overloaded,
        months,
      },
    };
    
    // Show physical tab
    if (physicalTab) physicalTab.hidden = false;
    if (physicalTabPanel) physicalTabPanel.hidden = false;
    
    // Render physical tab
    const tree = buildPhysicalTree(physical.outboundVisits, physical.onsiteVisits, decisions);
    const selectedSettlements = new Set();
    
    const updateActionButtons = renderPhysicalTab(root, tree, () => {
      // Selection changed - update buttons
      updateActionButtons?.();
    }, (action, payload) => {
      handlePhysicalAction(action, payload, state, els, root).catch((error) => {
        if (error?.guarded) return;
        showError(root, error?.message || 'Не удалось перестроить маршруты.');
      });
    }, selectedSettlements);
    
    state.physicalTabUpdateButtons = updateActionButtons;
    state.selectedPhysicalSettlements = selectedSettlements;
    state.physicalTree = tree;
    } catch (error) {
      console.warn('Physical schedule failed:', error);
      if (physicalTab) physicalTab.hidden = true;
      if (physicalTabPanel) physicalTabPanel.hidden = true;
      if (error?.guarded) {
        setStatus(root, 'Маршруты физлиц не построены. График ТО сформирован без них.');
      } else {
        showRetryableError(
          root,
          error?.importMessage || error?.message || 'Не удалось построить маршруты физлиц.',
          () => analyze(state, els, root),
        );
      }
    }
  } else {
    // Hide physical tab when disabled
    if (physicalTab) physicalTab.hidden = true;
    if (physicalTabPanel) physicalTabPanel.hidden = true;
    // Clear any stored decisions for this fingerprint since physical is disabled
    if (state.fingerprint) {
      clearPhysicalDecisions(state.fingerprint);
      state.fingerprint = null;
      state.physicalDecisions = {};
    }
  }
  
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

async function handlePhysicalAction(action, payload, state, els, root) {
  const { settlementKeys, settlementKey, newMode } = payload;
  
  switch (action) {
    case 'merge': {
      if (settlementKeys.length < 2) return;
      const mergeGroup = `merge_${Date.now()}`;
      for (const key of settlementKeys) {
        state.physicalDecisions[key] = {
          ...state.physicalDecisions[key],
          mergeGroup,
          mode: 'выезд',
        };
      }
      break;
    }
    case 'split': {
      for (const key of settlementKeys) {
        if (state.physicalDecisions[key]?.mergeGroup) {
          delete state.physicalDecisions[key].mergeGroup;
        }
      }
      break;
    }
    case 'forceOnsite': {
      for (const key of settlementKeys) {
        state.physicalDecisions[key] = {
          ...state.physicalDecisions[key],
          mode: 'площадка',
        };
      }
      break;
    }
    case 'toggleMode': {
      state.physicalDecisions[settlementKey] = {
        ...state.physicalDecisions[settlementKey],
        mode: newMode,
      };
      break;
    }
    case 'reset': {
      state.physicalDecisions = {};
      break;
    }
  }
  
  // Save decisions
  if (state.fingerprint) {
    savePhysicalDecisions(state.fingerprint, state.physicalDecisions);
  }
  
  // Re-analyze with new decisions
  await analyze(state, els, root);
}

async function download(state, els, root) {
  if (!state.result) return;
  els.downloadButton.disabled = true;
  setStatus(root, 'Формирование Excel…');
  let exportScheduleToXlsx;
  try {
    ({ exportScheduleToXlsx } = await loadModule(() => import('./exporter.js'), {
      container: messagesContainer(root),
      doc: root,
      message: 'Не удалось загрузить модуль экспорта Excel.',
      onRetry: () => download(state, els, root),
    }));
  } catch {
    els.downloadButton.disabled = false;
    setStatus(root, 'Модуль экспорта не загружен. Нажмите «Повторить».');
    return;
  }
  try {
    clearImportError(messagesContainer(root));
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

// GRAFIK-42: routing internals are dimmed and disabled while
// «Включать физлиц в график выездов» is unchecked. Values are untouched.
export function syncRoutingDisabledState(root) {
  const include = root.getElementById('includePhysical');
  const routing = root.getElementById('physicalRoutingFields');
  if (!routing) return;
  const enabled = Boolean(include?.checked);
  routing.dataset.disabled = enabled ? 'false' : 'true';
  for (const control of routing.querySelectorAll('input, select, textarea')) {
    control.disabled = !enabled;
  }
}

// GRAFIK-42: one label source for region options/checkboxes (incl. no-data hint).
// GRAFIK-41: new territories have no official regionCode (null) — show the name only.
function regionLabelBase(region) {
  return region.regionCode == null ? region.name : `${region.name} (${region.regionCode})`;
}

export function regionOptionLabel(region) {
  const base = regionLabelBase(region);
  if (!region.hasData) return `${base} — гео-справочник не загружен`;
  return region.count > 0 ? `${base} · НП: ${region.count}` : base;
}

export function neighboringRegionLabel(region) {
  const base = regionLabelBase(region);
  return region.hasData
    ? base
    : `${base} — гео-справочник не загружен, используется текстовая группировка по адресам`;
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

  // Region selection (GRAFIK-33/34/41)
  const inspectionRegionSelect = root.getElementById('inspectionRegion');
  const neighboringRegionsContainer = root.getElementById('neighboringRegions');
  const neighboringRegionsSearch = root.getElementById('neighboringRegionsSearch');
  const baseSettlementSelect = root.getElementById('baseSettlement');
  let _regionsLoaded = false;
  let _availableRegions = [];
  
  // Load regions and populate selects - called lazily when block-region or block-physical is opened
  async function loadRegionsForUI() {
    if (_regionsLoaded) return;
    try {
      const { getAvailableRegions } = await loadModule(() => import('./physical.js'), {
        container: messagesContainer(root),
        doc: root,
        message: 'Не удалось загрузить справочник регионов.',
        onRetry: () => loadRegionsForUI(),
      });

      const availableRegions = await getAvailableRegions();
      _availableRegions = availableRegions;
      
      // Populate inspection region select - sorted alphabetically by name
      if (inspectionRegionSelect) {
        const sortedRegions = [...availableRegions].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
        inspectionRegionSelect.innerHTML = '<option value="">— не выбран —</option>';
        for (const region of sortedRegions) {
          const option = document.createElement('option');
          option.value = String(region.dataId); // persist dataId
          option.textContent = regionOptionLabel(region);
          // Never disable - all regions selectable
          inspectionRegionSelect.appendChild(option);
        }
        if (state.settings.inspectionRegion) {
          inspectionRegionSelect.value = String(state.settings.inspectionRegion);
        }
      }
      
      // Populate neighboring regions - vertical list in scrollable box with search
      if (neighboringRegionsContainer) {
        renderNeighboringRegions(availableRegions);
      }
      
      // Setup search filter for neighboring regions
      if (neighboringRegionsSearch) {
        neighboringRegionsSearch.addEventListener('input', () => {
          const query = neighboringRegionsSearch.value.toLowerCase().trim();
          const filtered = _availableRegions.filter(r => 
            r.name.toLowerCase().includes(query) || String(r.regionCode).includes(query)
          );
          renderNeighboringRegions(filtered);
        });
      }
      
      // Populate base settlement select (will be filled when region is selected)
      if (baseSettlementSelect && inspectionRegionSelect) {
        async function updateBaseSettlements() {
          const dataId = Number(inspectionRegionSelect.value);
          if (!dataId) {
            baseSettlementSelect.innerHTML = '<option value="">— автоматически (регион не выбран) —</option>';
            clearImportError(messagesContainer(root));
            clearRegionNoDataHint(root);
            return;
          }
          const addressModule = await loadModule(() => import('./address.js'), {
            container: messagesContainer(root),
            doc: root,
            message: 'Не удалось загрузить справочник населённых пунктов.',
            onRetry: () => updateBaseSettlements().catch(() => {}),
          });
          // GRAFIK-43: structured result keeps the hint path explicit.
          const { settlements, failed } = await addressModule.loadSelectedRegionSettlements(dataId);
          if (failed.length > 0) showRegionNoDataHint(root);
          else clearRegionNoDataHint(root);
          // GRAFIK-44: the auto value comes from the export (mode of resolved
          // addresses) and is explained right in the option label.
          const { resolved, total } = addressModule.resolveAddressesForBase(
            state.records || [],
            settlements,
            dataId,
          );
          const manual = asBaseSettlement(state.settings.baseSettlement);
          const auto = addressModule.pickBaseSettlement(resolved, dataId, {
            manualSettlement: manual,
            regionSettlements: settlements,
            total,
          });
          baseSettlementSelect.innerHTML = '';
          const autoOption = document.createElement('option');
          autoOption.value = '';
          autoOption.textContent = addressModule.formatBaseSettlementLabel(auto);
          baseSettlementSelect.appendChild(autoOption);
          for (const s of settlements) {
            const option = document.createElement('option');
            option.value = JSON.stringify({ name: s.name, lat: s.lat, lon: s.lon, municipality: s.municipality });
            option.textContent = `${s.name} (${s.municipality})`;
            baseSettlementSelect.appendChild(option);
          }
          if (auto.source === 'manual' && manual) {
            const manualOption = [...baseSettlementSelect.options].find((option) => {
              if (!option.value) return false;
              const parsed = asBaseSettlement(option.value);
              return (
                parsed?.name === manual.name &&
                (parsed?.municipality || '') === (manual.municipality || '')
              );
            });
            if (manualOption) baseSettlementSelect.value = manualOption.value;
          }
          clearImportError(messagesContainer(root));
        }
        refreshBaseSettlementForUi = () => {
          if (Number(inspectionRegionSelect.value)) updateBaseSettlements().catch(() => {});
        };
        inspectionRegionSelect.addEventListener('change', () => {
          updateBaseSettlements().catch((error) => {
            console.warn('Failed to update base settlements:', error);
            if (error?.guarded) return;
            showRetryableError(
              root,
              'Не удалось загрузить список населённых пунктов.',
              () => updateBaseSettlements().catch(() => {}),
            );
          });
        });
        await updateBaseSettlements();
      }
      clearImportError(messagesContainer(root));
      _regionsLoaded = true;
    } catch (e) {
      // GRAFIK-46: never swallow a chunk-load failure into a silent console line.
      console.warn('Failed to load regions for UI:', e);
      if (e?.guarded) return;
      showRetryableError(
        root,
        'Не удалось загрузить справочник регионов и поселений.',
        () => loadRegionsForUI(),
      );
    }
  }
  
  function renderNeighboringRegions(regions) {
    if (!neighboringRegionsContainer) return;
    const sortedRegions = [...regions].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    neighboringRegionsContainer.innerHTML = '';
    for (const region of sortedRegions) {
      const label = document.createElement('label');
      label.className = 'region-checkbox';
      label.style.display = 'block';
      label.style.marginBottom = '4px';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'neighboringRegion';
      checkbox.value = String(region.dataId); // persist dataId
      // Never disable - all regions selectable
      if (state.settings.neighboringRegions?.includes(region.dataId)) {
        checkbox.checked = true;
      }
      // GRAFIK-43: neighbours load only when ticked; unticking keeps the cache.
      checkbox.addEventListener('change', () => {
        if (!checkbox.checked) return;
        loadNeighborRegion(region);
      });
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(` ${neighboringRegionLabel(region)}`));
      neighboringRegionsContainer.appendChild(label);
    }
  }

  async function loadNeighborRegion(region) {
    try {
      const addressModule = await loadModule(() => import('./address.js'), {
        container: messagesContainer(root),
        doc: root,
        message: 'Не удалось загрузить справочник населённых пунктов.',
        onRetry: () => loadNeighborRegion(region),
      });
      const { failed } = await addressModule.loadSettlementsWithStatus([region.dataId]);
      if (failed.length > 0) showRegionNoDataHint(root);
      else clearRegionNoDataHint(root);
    } catch (error) {
      console.warn('Failed to load neighboring region settlements:', error);
      if (error?.guarded) return;
      showRetryableError(
        root,
        'Не удалось загрузить соседний регион.',
        () => loadNeighborRegion(region),
      );
    }
  }
  
  // Lazy-load regions when block-region or the merged physical block is opened
  const regionBlock = root.getElementById('block-region');
  const physicalBlock = root.getElementById('block-physical');
  if (regionBlock) {
    regionBlock.addEventListener('toggle', () => {
      if (regionBlock.open) loadRegionsForUI();
    });
  }
  if (physicalBlock) {
    physicalBlock.addEventListener('toggle', () => {
      if (physicalBlock.open) loadRegionsForUI();
    });
  }

  // Physical schedule settings (GRAFIK-34/42)
  const includePhysicalCheckbox = root.getElementById('includePhysical');
  if (includePhysicalCheckbox) includePhysicalCheckbox.checked = state.settings.includePhysical;
  syncRoutingDisabledState(root);
  if (includePhysicalCheckbox) {
    includePhysicalCheckbox.addEventListener('change', () => syncRoutingDisabledState(root));
  }
  
  const physicalScopeSelect = root.getElementById('physicalScope');
  if (physicalScopeSelect) physicalScopeSelect.value = state.settings.physicalScope;
  
  const minUnitsInput = root.getElementById('minUnitsForVisit');
  if (minUnitsInput) minUnitsInput.value = String(state.settings.minUnitsForVisit);
  
  const maxRadiusInput = root.getElementById('maxRadiusKm');
  if (maxRadiusInput) maxRadiusInput.value = String(state.settings.maxRadiusKm);
  
  const avgSpeedInput = root.getElementById('avgSpeedKmh');
  if (avgSpeedInput) avgSpeedInput.value = String(state.settings.avgSpeedKmh);
  
  const onsiteAsAcceptingCheckbox = root.getElementById('onsiteAsAcceptingDays');
  if (onsiteAsAcceptingCheckbox) onsiteAsAcceptingCheckbox.checked = state.settings.onsiteAsAcceptingDays;
  
  const onsiteDayCheckboxes = root.querySelectorAll('input[name="onsiteDay"]');
  const onsiteDaysSet = new Set(state.settings.onsiteDays.map(Number));
  for (const checkbox of onsiteDayCheckboxes) {
    checkbox.checked = onsiteDaysSet.has(Number(checkbox.value));
  }
  
  const onsiteLocationRadio = root.querySelector(`input[name="onsiteLocation"][value="${state.settings.onsiteLocation}"]`);
  if (onsiteLocationRadio) onsiteLocationRadio.checked = true;
  
  const onsiteAddressInput = root.getElementById('onsiteAddress');
  const onsiteAddressField = root.getElementById('onsiteAddressField');
  if (onsiteAddressInput) onsiteAddressInput.value = state.settings.onsiteAddress;
  if (onsiteAddressField) onsiteAddressField.style.display = state.settings.onsiteLocation === 'own' ? 'block' : 'none';
  
  // Toggle onsite address field visibility
  const onsiteLocationRadios = root.querySelectorAll('input[name="onsiteLocation"]');
  for (const radio of onsiteLocationRadios) {
    radio.addEventListener('change', () => {
      if (onsiteAddressField) onsiteAddressField.style.display = radio.value === 'own' ? 'block' : 'none';
    });
  }
  
  // Sync onsite days with accepting days
  const acceptingDayCheckboxes = root.querySelectorAll('input[name="acceptingDay"]');
  if (onsiteAsAcceptingCheckbox) {
    onsiteAsAcceptingCheckbox.addEventListener('change', () => {
      if (onsiteAsAcceptingCheckbox.checked) {
        for (const checkbox of onsiteDayCheckboxes) {
          const acceptingCheckbox = root.querySelector(`input[name="acceptingDay"][value="${checkbox.value}"]`);
          if (acceptingCheckbox) checkbox.checked = acceptingCheckbox.checked;
        }
      }
    });
  }
  
  // Sync accepting days to onsite days when onsiteAsAcceptingDays is checked
  for (const checkbox of acceptingDayCheckboxes) {
    checkbox.addEventListener('change', () => {
      if (onsiteAsAcceptingCheckbox?.checked) {
        const onsiteCheckbox = root.querySelector(`input[name="onsiteDay"][value="${checkbox.value}"]`);
        if (onsiteCheckbox) onsiteCheckbox.checked = checkbox.checked;
      }
    });
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

  els.analyzeButton?.addEventListener('click', () => {
    analyze(state, els, root).catch((error) => {
      if (error?.guarded) return;
      showError(root, error?.message || 'Не удалось сформировать график.');
    });
  });
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
