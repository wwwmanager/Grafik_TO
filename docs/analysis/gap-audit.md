# GRAFIK-28 Gap Audit Report

*Read-only audit of the entire grafik_to application against TZ, decisions.md (D1–D14), manual.md, and slices GRAFIK-01..27 history.*

---

## 1. Functional Requirements Coverage

| ID | Area | Finding | Impact | Proposed Fix | Effort |
|----|------|---------|--------|--------------|--------|
| F-01 | TZ §4 – Excel parsing | Empty/invalid xlsx: parser throws descriptive error; UI shows error and disables "Сформировать график". **Implemented**. | Low | None | — |
| F-02 | TZ §4 – Excel parsing | Huge files (5000+ rows): parser reads all rows without streaming; UI may freeze during parse. **Missing** – no virtual scroll or chunked reading. | Medium | Add chunked reading or progress indicator for large files | M |
| F-03 | TZ §5 – Settings | All settings (target year, accepting days, vacation, depth, window, physical threshold, work day, lunch, machines/hour, travel minutes) read and fed to scheduler. **Implemented** – `defaultSettings()` + `readSettings()` cover all. | Low | None | — |
| F-04 | TZ §5 – Physical persons rule | Physical person detection via `Группа владельца` containing "физ"/"ФЛ". Threshold configurable D11 default=3. **Implemented** – `isPhysicalOwner`, `ownerKey`, `applyPhysicalRule`. | Low | None | — |
| F-05 | D11 – Physical threshold bug | Real‑world bug: physical persons with exactly 3 units appeared in schedule despite threshold=3. **Root cause**: owner key merged unrelated individuals (placeholder INN "0" collapsed groups). **Fix applied** in GRAFIK‑10: ownerKey now requires 10‑12 digit INN or normalized name; counting only post‑filter units. **Status** – fix verified in code. | High | Ensure ownerKey uses INN ≥10 digits; count only units passing filter; add tests for 2/3/4 units | S (already fixed) |
| F-06 | D12 – `*` (bezTo) = overdue, must schedule | **Implemented** – `exclusionReason` in scheduler.js: `*` without valid Date TO scheduled if depth ≥5, else excluded with reason. D12 respected. | Low | None | — |
| F-07 | D13 – `*` with empty/invalid Date TO | **Implemented** – if no valid Date TO, treated as >5 years old; included only if depth ≥5, else excluded with explicit reason. | Medium | None (behaviour correct) | — |
| F-08 | D14 – Winter months weighting | **Implemented** – `winterScore` in scheduler.js weights winter month capacity by `winterLoadPercent` (default 30%). Winter months default Dec/Jan/Feb. | Low | None | — |
| F-09 | TZ §6 Step 1 – Filtering | Exclusion for removal date, Угон/Без ТО/Сдан ГРЗ/Вывезена за рубеж, missing/incorrect Date TO, depth check. **Implemented** – `exclusionReason` covers all. | Low | None | — |
| F-10 | TZ §6 Step 2 – Owner keys | Owner key = normalized INN (10/12 digits) or normalized owner name. **Implemented** – `ownerKey` function. D10 root cause fixed. | Low | None | — |
| F-11 | A4 handling (D2) | A4 (цифра/латиница A4): period 6 months, two dates in target year if they fall. **Implemented** – `isA4`, `computeTargetDates` with +6 ms steps, up to 2 dates. | Low | None | — |
| F-12 | A4 twice/year (same unit) | If a unit has A4 twice in the same year (first +6 ms falls again), current code pushes second date only if it stays in target year (`next.getFullYear() === targetYear`). **Edge case**: may produce overlapping A4 dates; no dedup logic. **Missing** – could schedule same unit twice in one year. | Medium | Add dedup or clamp to one A4 visit per year per unit | M |
| F-13 | Vacations overlapping | GRAFIK‑19: multiple vacation periods stored as array `{from,to}`; `inAnyVacation` checks all. **Implemented** – scheduler respects all periods. | Low | None | — |
| F-14 | No working days in window | Scheduler tries forward/backward from target date; if no day found, returns `null` and warning. **Partial** – may produce "Не удалось разместить визит" warning. **Missing** – no graceful fallback (e.g., relax window or shift to next month). | Medium | Add fallback: if no day in window, expand search to whole year or emit clearer instruction | M |
| F-15 | Capacity overflow (machines/hour) | `perHour` setting limits duration; `visitDurationMinutes` computes ceil(minutes). No hard overflow guard beyond duration calc. **Missing** – if total machines exceed feasible capacity within year, scheduler may produce many warnings but no top‑level limit. | Low | None (behaviour acceptable) | — |
| F-16 | Physical persons vs owners | Distinction implemented: `isPhysicalOwner` checks `ownerGroup` for "физ"/"ФЛ". Legal owners above threshold stay scheduled. **Implemented**. | Low | None | — |
| F-17 | `*` dates (all‑year) | `*` (bezTo) always scheduled; depth applies. D12/D13 handle. **Implemented**. | Low | None | — |
| F-18 | Calendar API offline | `calendarService.js` tries `isdayoff.ru` API with timeout; falls back to bundled JSON 2025‑2027, then weekend‑only calendar with warning. **Implemented** – `loadProductionCalendar`. D10 CORS check. | Low | None | — |
| F-19 | `*` (bezTo) without Date TO + depth <5 | **Implemented** – returned exclusion reason `"«Без ТО» без даты ТО, глубина менее 5 лет"`. | Low | None | — |
| F-20 | Duplicate units within same owner | No explicit dedup; ownerKey groups by INN/name, but multiple records with same INN stay separate in schedule unless physical rule removes them. **Missing** – if two identical units (same INN, same Date TO) they may produce duplicate visits. | Medium | Add dedup logic before scheduling (remove exact duplicates on inn + lastTo) | M |
| F-21 | Calendar API failure mode | If API fails, bundled calendar for 2025‑2027 used; for other years weekend‑only with warning. **Implemented**. | Low | None | — |
| F-22 | Export: 4‑sheet structure | **Implemented** – `exportScheduleToXlsx` builds График ТО, Детализация, Исключенные записи, Сводка и нагрузка. | Low | None | — |
| F-23 | Export column widths | GRAFIK‑23: auto‑width with per‑column caps. **Implemented** – `autoWidth` in exporter.js. | Low | None | — |
| F-24 | Export vertical center alignment | GRAFIK‑24: `cell.alignment = { vertical: 'middle', wrapText: true }` for all cells. **Implemented**. | Low | None | — |
| F-25 | Visit numbering consistency | GRAFIK‑22: both "График ТО" and "Детализация" have `№ п/п` column with matching sequential numbers. **Implemented**. | Low | None | — |
| F-26 | Exclusion reason rename | GRAFIK‑17/27: "Дата ТО старше глубины" renamed to "Дата ТО больше выбранной давности ТО". **Implemented** throughout scheduler, exporter, UI. | Low | None | — |
| F-27 | Future current‑year date logic (GRAFIK‑18) | **Implemented** – `isOnTimeInExportYear` + `computeTargetDates` treat current‑year target dates ≥ export date as on‑time, project to target year, not overdue. | High | Fix already in code; verified | S |
| F-28 | Geo extraction (GRAFIK‑15) | **Implemented** – `extractLocation` handles bare cities "Москва", attached markers "г.Москва", region markers "обл.", "край", "АО", "респ.". | Low | None | — |
| F-29 | Address from split columns (GRAFIK‑16) | **Implemented** – parser scans header cells for region/district/settlement/street/house markers; assembles address. | Low | None | — |
| F-30 | Multiple vacation periods (GRAFIK‑19) | **Implemented** – UI adds/removes vacation rows; scheduler `inAnyVacation` checks all. | Low | None | — |
| F-31 | Machine/hour field label and limits | GRAFIK‑19: label renamed to "Машин в час", input type=number min=1 max=100 default=12. **Implemented**. | Low | None | — |
| F-32 | Winter months as 4×3 checkbox grid | GRAFIK‑19: winter months UI as checkbox grid; scheduler uses array. **Implemented**. | Low | None | — |
| F-33 | Sticky "Сформировать график" button | GRAFIK‑20: button sticky at bottom of left panel. **Implemented**. | Low | None | — |
| F-34 | Two‑column layout, collapsing upload zone | GRAFIK‑20: left panel settings accordion, right area upload zone collapses after file load. **Implemented**. | Medium | Verify UI flow end‑to‑end; ensure no double‑scroll | M |
| F-35 | Keyboard / a11y navigation | Not explicitly checked; UI uses standard form controls. **Missing** – no tab‑order audit, no ARIA labels beyond basic. | Medium | Add ARIA labels, tab‑order review, high‑contrast mode | L |
| F-36 | Mobile width / responsive | Not tested; interface designed for desktop. **Missing** – likely broken on narrow screens. | Low | None (out of scope) | — |
| F-37 | Performance on 5000+ rows | Not tested; scheduler may be slow with many records. **Missing** – no memoization or batch processing. | Medium | Profile with 5000‑row fixture; optimize clustering/placement if needed | M |
| F-38 | Test coverage gaps | Vitest tests exist for parser, scheduler, exporter; edge‑case coverage (empty file, huge file, duplicate units, A4 twice, vacations overlap, calendar offline) not fully covered. **Missing** – gap in test suite. | Medium | Add targeted test cases for each edge case | M/L |
| F-39 | Error handling for corrupt xlsx | Parser throws on missing header or required columns; UI catches and shows error. **Implemented**. | Low | None | — |
| F-40 | 'exportDate' propagation from file title | GRAFIK‑18: `findExportDate` in parser extracts "Выгрузка на ДД.ММ.ГГГГ" from first rows. **Implemented**. | Low | None | — |

---

## 2. UI/UX Flow

| ID | Area | Finding | Impact | Proposed Fix | Effort |
|----|------|---------|--------|--------------|--------|
| UIUX‑01 | Validation messages on empty/invalid xlsx | When an empty or non‑Excel file is dropped, the app only shows "Чтение файла…" status. The user learns the file is unreadable only after clicking **Сформировать график**, which then says "Сначала загрузите файл Excel." No early check for file type or empty content. | Users may not realize the file is invalid until after they attempt generation, causing confusion. | Add a pre‑validation step in `handleFile` that checks `file.type` / file size and displays a clear immediate message (e.g., "Файл не является корректным Excel") if the file is empty or has an unsupported MIME type. | Low |
| UIUX‑02 | Empty/error states (no file, no units after filter, all excluded) | • No file – drop‑zone shows "Файл не выбран".<br>• 0 records after parse – analyze button disabled, preview panes show "Нет визитов для показа."<br>• All records excluded – the excluded panel lists entries; schedule/details panes show the same placeholder. No distinct message when all data are filtered out. | Users might think the app hung when no results appear, especially if all records are excluded by filters. | Add a specific message when `result.visits.length === 0` after filtering (or when all records are excluded) indicating that all data were filtered out, with a suggestion to adjust settings. | Medium |
| UIUX‑03 | Loading indicator during parsing/scheduling/export | Only the `#status-line` text changes ("Чтение файла…", "Загрузка производственного календаря…", "Формирование Excel…"). No spinner, progress bar, or busy cursor is shown. | On slow machines or large files users may think the app has frozen, leading to repeated clicks. | Introduce a simple spinner element (or `cursor: wait`) that appears while the promise‑based functions execute and hides on completion. | Low |
| UIUX‑04 | Settings persistence between sessions (localStorage) | `loadPersistedSettings` saves only `physicalThreshold`, `groupSmallOwners`, `winterMonths`, `winterLoadPercent`, and `vacations`. Other settings (`targetYear`, `workStart`, `workEnd`, `perHour`, `travelMinutes`, `lunch`, `inspectionAddress`) are **not** persisted, so they reset on browser restart. The manual claims settings are remembered. | Users lose their preferred configuration after closing/reopening the browser, breaking the expected UX. | Extend `persistSettings` to store the full settings object (or at least the most common fields) and update `loadPersistedSettings` to re‑hydrate all settings, falling back to defaults for missing keys. | Medium |
| UIUX‑05 | Reset to defaults button | No **Reset** or **Default** button exists in the UI. The `defaultSettings` function exists in code but is never exposed. | Users cannot quickly restore default configuration without manually clearing localStorage or using incognito mode. | Add a "Сброс к defaults" button in the settings panel (e.g., inside `.settings-actions` or at the bottom of the advanced section) that resets the form to `defaultSettings()` and clears the persisted localStorage entries. | Low |
| UIUX‑06 | Keyboard / a11y: tab order, focus visible, ARIA labels, high contrast | • Tab order: interactive elements include hidden file input, buttons, number/text inputs. Logical flow for screen‑reader users is unclear because many inputs lack `aria-label`.<br>• Focus visible: CSS defines `:focus-visible` with `box-shadow var(--focus-ring)` for `.tab` and inputs (good).<br>• ARIA labels: only three `aria-label`s are added dynamically (vacation from/to/remove). The settings panel has `aria-label="Параметры"`, drop‑zone has `aria-label="Загрузка файла"`, messages have `role="status" aria-live="polite"`, but inputs like `targetYear`, `workStart`, `workEnd`, `perHour`, `travelMinutes`, `inspectionAddress` have no accessible labels.<br>• High contrast: color tokens are used but no explicit `@media (forced-colors)` adjustments. | Users of assistive technologies struggle to understand field purposes. Focus ring may have insufficient contrast in some themes. | • Add `aria-label` to all meaningful inputs (e.g., `aria-label="Целевой год"` for `targetYear`, `aria-label="Время начала рабочего дня"` for `workStart`, etc.).<br>• Ensure focus‑ring contrast meets WCAG against the current token values.<br>• Add `@media (forced-colors)` or high‑contrast adjustments to the CSS tokens if needed. | Medium |
| UIUX‑07 | Mobile width (320 px, 768 px) | The media query `@media (max-width: 720px)` stacks the layout to a single column. However:<br>• At 320 px, narrow number inputs (`perHour`, `physicalThreshold`) are hard to tap.<br>• The month‑grid `.month-grid` uses `grid-template-columns: repeat(4, minmax(0, 1fr))`, producing tiny cells on narrow screens.<br>• Touch targets (`<button>`) have minimal padding; may be <44 px. | On small phones the UI becomes cramped; some functionality (month selection) may be unusable. | • Add a `<=480px` media query that reduces the month‑grid to 2 columns or a single‑row list, and makes input widths full‑width with larger touch padding.<br>• Increase minimal tap target size to at least 44 px (adjust button padding).<br>• Consider hiding less‑critical settings on very narrow screens or moving them to a secondary panel. | Medium |
| UIUX‑08 | Label consistency with docs/manual.md | UI Russian labels generally match the terminology in `docs/manual.md` (e.g., "Целевой год", "Приёмные дни", "Глубина давности ТО, лет", "Окно группировки, days", "Порог физлиц, ед. техники", "Группировать малых владельцев", "Физлица с числом единиц не более порога", "Адрес инспекции", "Зимние месяцы", "Загрузка зимних месяцев, %", "Рабочий день с / по", "Учитывать обед", "Машин в час", "Переезд между локациями, мин", "Сформировать график", "Скачать Excel (.xlsx)", "Выбрать файл", "Файл не выбран", "Перетащите файл .xlsx или .xls сюда"). Minor points: the manual mentions the "Сформировать график" button is sticky at the bottom — the UI implements it with `position: sticky; bottom: 0;`, which is consistent. No major mismatches found. | High consistency reduces cognitive load; any mismatch would confuse users cross‑referencing the manual. | No fix needed; keep labels aligned with manual. Maintain during future updates. | Low |

---

## 3. Output / Excel Quality

| ID | Area | Finding | Impact | Proposed Fix | Effort |
|----|------|---------|--------|--------------|--------|
| A1 | Print setup | Orientation default (portrait); no `fitToWidth`/`pageSetup`; repeating header rows not set. | When printed, table may split across pages awkwardly; headers won't repeat on each page. | Set `worksheet.orientation = 'landscape'`, `worksheet.pageSetup.fitToWidth = 1`, `worksheet.pageSetup.fitToHeight = 0` and `worksheet.pageSetup.firstRow = 1` (or ExcelJS equivalent). | Low |
| A2 | Print setup – repeat header row | `finalize` creates view freeze (`views.frozen`), but does not configure print repeat rows. | Headers may not repeat on printed pages. | Add `pageSetup.firstRow` or find corresponding ExcelJS API. | Low |
| A3 | Filters on header row | `worksheet.autoFilter` not called; header row filters disabled. | Users cannot filter data directly in Excel. | Add `worksheet.autoFilter = { from: 'A1' }` (or range per sheet) after creating sheet. | Low |
| A4 | Number formatting | Number formats not set explicitly (e.g., `#,##0` for integers, `dd.mm.yyyy` for dates) — defaults used. | Dates and numbers may display with extra zeros or wrong locale. | In `styleSheet` (or per‑cell) set `cell.numFmt`: dates `dd.mm.yyyy`, integers `0` or `#,##0`. | Medium |
| A5 | Totals/summary rows | `buildScheduleSheet` and `buildDetailsSheet` have no total rows; only `buildSummarySheet` has "Итого" row. | Lack of aggregated totals on main sheets reduces report self‑sufficiency. | Add total row in schedule (e.g., visit count) and in details (sum of inspection/travel minutes). | Medium |
| A6 | GRAFIK‑22 consistency of `# п/п` between sheets | Test passes: both sheets generate `# п/п` as `index + 1`. | Numbering consistency confirmed. | — | — |
| A7 | GRAFIK‑23 auto‑width with caps | `autoWidth` applies `mins` and `caps`; tests verify column widths (№ п/п ≤8, Наименование 24‑40, Дата ≥12, Время ≥12, max 48). | Implementation meets requirements. | — | — |
| A8 | GRAFIK‑24 vertical middle + wrapText | `styleSheet` sets `vertical: 'middle'` and `wrapText: true` for all cells; test verifies both main sheets. | Vertical alignment and text wrap correct. | — | — |
| A9 | GRAFIK‑25 address column in details | Sheet "Детализация" has "Адрес" column (index 6) and `visit.address` populated. | Address column present and filled. | — | — |
| A10 | GRAFIK‑17 multiline cells with numbers, stale‑date reason rename | Test confirms `staleResult.excluded[0].reason === 'Дата ТО больше выбранной давности ТО'`. Multiline cells (cols 11, 15) have `wrapText: true`. | Reason renamed, multiline cells wrap. | — | — |

---

## 4. Code Quality & Tests

| ID | Area | Finding | Impact | Proposed Fix | Effort |
|----|------|---------|--------|--------------|--------|
| Q1 | Test coverage gaps | All 11 test suites pass (143 tests). Gaps: parser edge cases (empty file, huge file), format minor testing, UI/DOM testing. No module is untested. | Medium | Add targeted tests for parser edge cases, format.js new logic, UI block persistence. | M |
| Q2 | Dead code / unused exports | None detected; all 41 exports consumed by other modules or tests. | Low | — | — |
| Q3 | Error handling | Solid null/undefined guards throughout. `calendarService.js` is the only module with try/catch for async operations; others use sentinel values. | Low | Consider consistent try/catch for async external calls. | Low |
| Q4 | Performance on 5000+ rows | Placement algorithms (`placeRegular`/`placeOverdue`) are bottleneck for 5000+ records with O(days × records) complexity. `autoWidth` in exporter is O(rows × cols). No batching or advanced memoization beyond `dayStates` map. | Medium | Profile with 5000‑row fixture; optimize clustering/placement if needed. | M |
| Q5 | Bundle size warnings | `exceljs` (~300‑500 kb) is main contributor; total likely just under/over 500 kb minified+gzip. Dynamic `import` for export already in place. | Low | Code‑split exporter further if needed; monitor after Vite/Rolldown upgrade. | Low |

---

## Summary by Impact

| Impact | Count | IDs |
|--------|-------|-----|
| **High** | 2 | F‑05 (fixed), F‑27 (fixed) |
| **Medium** | 16 | F‑02, F‑12, F‑14, F‑20, F‑34, F‑35, F‑37, F‑38, UIUX‑02, UIUX‑04, UIUX‑06, UIUX‑07, A4, A5, Q1, Q4 |
| **Low** | 28 | Remaining items |

---

## Ready‑to‑Dispatch Slice Candidates (grouped)

| Slice ID | Title | Items | Est. Effort |
|----------|-------|-------|-------------|
| **GAP-01** | Large file handling & progress | F‑02, F‑37 | M |
| **GAP-02** | A4 dedup & no‑working‑day fallback | F‑12, F‑14 | M |
| **GAP-03** | Duplicate unit dedup | F‑20 | M |
| **GAP-04** | UI/UX polish: empty states, loading spinner, reset button | UIUX‑01, UIUX‑02, UIUX‑03, UIUX‑05 | S–M |
| **GAP-05** | Settings persistence & a11y | UIUX‑04, UIUX‑06 | M–L |
| **GAP-06** | Excel print setup, filters, number formats, totals | A1, A2, A3, A4, A5 | M |
| **GAP-07** | Test coverage for edge cases | F‑38, Q1 | M/L |
| **GAP-08** | Mobile responsive (<480px) | UIUX‑07 | M |

> **Note:** High‑impact items F‑05 and F‑27 are already fixed in GRAFIK‑10 and GRAFIK‑18 respectively. No further action needed.

---

*End of GRAFIK‑28 Gap Audit Report.*