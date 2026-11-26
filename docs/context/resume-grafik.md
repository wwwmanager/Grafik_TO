# Состояние работ по grafik_to (для продолжения сессии)

Обновлено: 2026-11-26. Источник истины по задачам — `docs/context/slices.json`; по решениям — `docs/spec/decisions.md` (D15–D26).

## Сейчас в работе
- **Цепочка:** приняты GRAFIK-39 (`c9945b6`), GRAFIK-33 (`c3feeb3`), GRAFIK-34 (`4bbc7d1`), GRAFIK-35 (`88fdcbd`), GRAFIK-40 (`7b14e39`), GRAFIK-41 (`e2a6c38`), GRAFIK-42 (`598cf4c`), GRAFIK-46-DEPLOY-CACHE-GUARD (`6e5f9c4`, D27). GRAFIK-36 закрыт как rejected (2 раунда, заменён 40). GRAFIK-47 (`483befb`, D28) — сдан orch2. GRAFIK-43 (`d2bf12d`, D29) — принят. GRAFIK-44 (`c6d207a`, D30) — принят. GRAFIK-45 (`28262a0`, D31) — принят, задеплоен. **Очередь пуста; сайт задеплоен, `npm run check:deploy` зелёный.**
- **Процесс (владелец):** перед каждым слайсом — `/compact` оркестратору; приоритет — сначала Челябинская область (dataId 74), остальные регионы потом; 43/44/45 — после 47.
- **Данные:** 81/89 классических субъектов + 4 новых территории, `public/data/settlements/<dataId>.json` 1:1 с `regions.json`; dataId 74 = Челябинская (regionCode 74), 1267 записей. Нет: Московская обл. (dataId 39), Крым (80), Севастополь (81), Мордовия (82), ДНР/ЛНР/Запорожская/Херсонская (85–88) — пересобрать `npm run data:settlements -- --region <dataId>` при следующем квартальном прогоне.
- **Код:** `address.js` (резолв НП, D24), `physical.js` (маршруты D20), `physicalTab.js` (вкладка «Физлица», localStorage только по ключам НП), объединённый блок «Физлица» в настройках. `scripts/build-settlements.mjs` — единственный источник (dataId, regionCode, iso, name, bbox); `src/modules/regions-table.js` регенерируется из него (`generate-regions-table.mjs`). GRAFIK-47: `resolveSettlement` работает через кэшированный индекс (`createSettlementIndex`, WeakMap), грузится только нужный регион (`selectRegionDataIds`), радиусные запросы — через grid, жёсткий дедлайн 15 с + прогресс «поселения X/Y» / «месяцы X/12» (`createBuildRuntime`, D28). GRAFIK-43: `loadSettlementsWithStatus` (in-flight dedupe, LRU 6, `failed[]` без throw), `loadSelectedRegionSettlements` (0 fetch без выбора), соседние грузятся по галочке (D29). Тесты 323 (20 файлов).
- **UI:** настройки — flex-колонка, скроллится только `.settings-scroll`, кнопка в непрокручиваемом футере; без горизонтального скролла на 360px, длинные тексты переносятся; дни недели переносятся; короткие числа — `.grid-2`; fieldset обнулён; аккордеон с aria-expanded/aria-controls и бейджем без ellipsis; при снятом «Включать физлиц» маршрутизация dim+disabled. Регион инспекции и соседние — все 89 доступны, отображается regionCode, без гео-данных — инлайн-подсказка; соседние — вертикальный список в прокручиваемом блоке (max-height 180px) с поиском. Настройки сохраняют dataId. База маршрутов (GRAFIK-44): авто по моде разрешённых адресов с подписью «— автоматически (Тайнак, 42 адреса из 118) —», ручной выбор важнее и переживает реимпорт, пока НП есть в справочнике; при неудаче — «первый в регионе» (D30). До построения графика в блоке «Физлица» — сводка «Распознано N из M адресов · не разобрано K» с раскрываемым списком неразобранных (номер импорта + адрес, кнопка копирования), баннер при N=0; отчёт только в памяти, без localStorage/Excel/логов (D31). Если справочник выбранного региона не загрузился — предупреждение «Гео-справочник для региона не загружен — используется текстовая группировка по адресам» (`#region-no-data-hint`), группировка по адресам продолжает работать.
- **Устойчивость к устаревшему кэшу (GRAFIK-46, D27):** `public/cache-guard.js` — стабильный classic-скрипт в `<head>`: один reload с `?v=` за сессию, затем баннер «Загружена устаревшая версия…»; `resilience.js` — `installPreloadGuard()` (vite:preloadError) и `loadModule()` для всех dynamic import с inline-ошибкой и кнопкой «Повторить». Проверка живого сайта: `npm run check:deploy` (fetch index, HEAD всех assets/*, сверка с dist).
- **Осталось (ручное):** владельцу один раз обновить вкладку с Ctrl+F5 (старый закэшированный HTML не содержит guard); живой прогон построения маршрутов на реальном экспорте 1267 НП (гейт владельца); выборочная проверка НП; живая проверка вкладки «Физлица»; визуальная проверка панели настроек на 360px (гейт владельца); пересборка отсутствующих регионов при квартальном прогоне.

## Порядок задач (по одной, следующая после приёмки предыдущей)
1. GRAFIK-39 — чистка данных Челябинской области.
2. GRAFIK-36-ALL-REGIONS — справочники всех регионов РФ через тот же скрипт (он должен быть универсальным).
3. GRAFIK-33-ADDR-RESOLVER — разбор адреса, выбор региона/соседних, поиск по справочнику.
4. GRAFIK-34-PHYSICAL-SCHEDULE — маршруты по соседним НП за один день, площадка, строки Excel (D20).
5. GRAFIK-35-PHYSICAL-TAB — вкладка «Физлица», ручные объединения, хранение в браузере.
6. GRAFIK-41-REGION-CODES — разделение dataId / regionCode, регенерация regions-table.js, UI без disabled, поиск соседних.
7. GRAFIK-42-SETTINGS-PANEL-UX — переполнение, объединённый блок «Физлица», непрокручиваемый футер, миграция ключей аккордеона, a11y (D26).
8. GRAFIK-46-DEPLOY-CACHE-GUARD — guard от устаревшего HTML/404-чанков, retry для dynamic import, `scripts/check-deploy.mjs`, deploy (D27).
9. GRAFIK-47-CHELYABINSK-ROUTE-PERF — только Челябинская: бенчмарк 74.json, кэш индекса резолвера, grid, дедлайн 15 с с прогрессом (D28).
10. GRAFIK-43-LAZY-SETTLEMENTS — загрузчик: dedupe, LRU 6, structured failed[], lazy соседние, hint (D29).
11. GRAFIK-44-AUTO-BASE-SETTLEMENT — база из экспорта: мода разрешённых адресов, tie-break, ручной override (D30).
12. GRAFIK-45-UNRESOLVED-REPORT — сводка распознанных/неразобранных до графика, copy, баннер N=0, in-memory (D31).

Тексты заданий 33, 34, 35, 36, 41 уже лежат в леджере. Отправка:
`pwsh C:\Users\User\AppData\Local\Temp\opencode\dispatch-planned.ps1 -Id <id>`
Приёмка: `pwsh C:\Users\User\AppData\Local\Temp\opencode\accept-generic.ps1 -Id <id> -Commit <hash> -Retro "<строка>"`.

## Проверка после GRAFIK-39 (владельцем, 10 мин)
Открыть https://wwwmanager.github.io/Grafik_TO/data/settlements/74.json, найти 10–15 знакомых посёлков, сверить район и координаты на карте OSM. Отдельно: 3–4 у границ районов, дубли названий, «Тайнак/Тундуш → Златоуст».

## Открытые вопросы
- **GRAFIK-21** (руководство) у orch2 (`ses_e358b9c96ffeVwXivNx5cx0Tei`), отчёта нет. В рабочем дереве незакоммичены `package.json` (там `docx`, должно уйти в devDependencies), `package-lock.json`, `docs/manual_new.docx`, `*.bak`, `~$manual.docx` — при приёмке убрать библиотеку из основных зависимостей и удалить временные файлы.
- **L3 для grafik_to** — решение владельца не получено. Причина: единственный пишущий L3 (`l3-nemotron`) может писать только в `C:\_Architect-os\dashboard`; `general`/`explore` — только чтение. Предложение: своя `.opencode` в `G:\_Grafik_TO` с L3 и bash-разрешением на `npm --prefix G:\_Grafik_TO ...`.
- GRAFIK-28 (аудит) и GRAFIK-30 (разведка) приняты как документы; исправления по Excel/доступности — отдельными задачами позже.
- Поле `groupWindowDays` теперь ограничено 1–365 (GRAFIK-31 принят, `6b33bb5`).

## Факты об окружении
- Проект: `G:\_Grafik_TO`, публичный репозиторий, сайт https://wwwmanager.github.io/Grafik_TO/ (Pages, deploy по push в main).
- Проверка: `npm --prefix G:\_Grafik_TO run verify` (lint, тесты, сборка).
- Справочник: `public/data/settlements/74.json` (Челябинская, dataId=74, regionCode=74), скрипт `scripts/build-settlements.mjs`, лицензия `public/data/LICENSE-OSM.txt`.
- Политика: в рантайме внешних сервисов нет (кроме `isdayoff.ru` с офлайн-фолбэком); OSM нужен только при сборке данных. Приватность: реальные адреса владельца в репозиторий не попадают.
