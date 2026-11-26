# Состояние работ по grafik_to (для продолжения сессии)

Обновлено: 2026-11-26. Источник истины по задачам — `docs/context/slices.json`; по решениям — `docs/spec/decisions.md` (D15–D25).

## Сейчас в работе
- **Цепочка закрыта 2026-11-26.** Приняты: GRAFIK-39 (`c9945b6`), GRAFIK-33 (`c3feeb3`), GRAFIK-34 (`4bbc7d1`), GRAFIK-35 (`88fdcbd`), GRAFIK-40 (`7b14e39`), GRAFIK-41 (в работе). GRAFIK-36 закрыт как rejected (2 раунда, заменён 40).
- **Данные:** 81/89 классических субъектов + 4 новых территории, `public/data/settlements/<dataId>.json` 1:1 с `regions.json`; dataId 12 = Челябинская (regionCode 74), 1267 записей. Нет: Московская обл. (dataId 39), Мордовия (dataId 83), Крым (dataId 81), Севастополь (dataId 82) — пересобрать `npm run data:settlements -- --region <dataId>` при следующем квартальном прогоне.
- **Код:** `address.js` (резолв НП, D24), `physical.js` (маршруты D20), `physicalTab.js` (вкладка «Физлица», localStorage только по ключам НП), блоки 4/5 в настройках. `scripts/build-settlements.mjs` — единственный источник (dataId, regionCode, iso, name, bbox); `src/modules/regions-table.js` регенерируется из него (`generate-regions-table.mjs`). Тесты 260+ (14 файлов).
- **UI:** Регион инспекции и соседние — все 89 доступны (нет disabled), отображается regionCode: `Челябинская область (74)`. Без гео-данных — инлайн-подсказка «гео-справочник не загружен — используется текстовая группировка по адресам». Соседние регионы — вертикальный список в прокручиваемом блоке (max-height 180px) с поиском. Настройки сохраняют dataId → никакой миграции localStorage.
- **Осталось (ручное):** выборочная проверка НП владельцем; живая проверка вкладки «Физлица» на реальной выгрузке; пересборка 39/81/82/83 при следующем квартальном прогоне.

## Порядок задач (по одной, следующая после приёмки предыдущей)
1. GRAFIK-39 — чистка данных Челябинской области.
2. GRAFIK-36-ALL-REGIONS — справочники всех регионов РФ через тот же скрипт (он должен быть универсальным).
3. GRAFIK-33-ADDR-RESOLVER — разбор адреса, выбор региона/соседних, поиск по справочнику.
4. GRAFIK-34-PHYSICAL-SCHEDULE — маршруты по соседним НП за один день, площадка, строки Excel (D20).
5. GRAFIK-35-PHYSICAL-TAB — вкладка «Физлица», ручные объединения, хранение в браузере.
6. GRAFIK-41-REGION-CODES — разделение dataId / regionCode, регенерация regions-table.js, UI без disabled, поиск соседних.

Тексты заданий 33, 34, 35, 36, 41 уже лежат в леджере. Отправка:
`pwsh C:\Users\User\AppData\Local\Temp\opencode\dispatch-planned.ps1 -Id <id>`
Приёмка: `pwsh C:\Users\User\AppData\Local\Temp\opencode\accept-generic.ps1 -Id <id> -Commit <hash> -Retro "<строка>"`.

## Проверка после GRAFIK-39 (владельцем, 10 мин)
Открыть https://wwwmanager.github.io/Grafik_TO/data/settlements-12.json, найти 10–15 знакомых посёлков, сверить район и координаты на карте OSM. Отдельно: 3–4 у границ районов, дубли названий, «Тайнак/Тундуш → Златоуст».

## Открытые вопросы
- **GRAFIK-21** (руководство) у orch2 (`ses_e358b9c96ffeVwXivNx5cx0Tei`), отчёта нет. В рабочем дереве незакоммичены `package.json` (там `docx`, должно уйти в devDependencies), `package-lock.json`, `docs/manual_new.docx`, `*.bak`, `~$manual.docx` — при приёмке убрать библиотеку из основных зависимостей и удалить временные файлы.
- **L3 для grafik_to** — решение владельца не получено. Причина: единственный пишущий L3 (`l3-nemotron`) может писать только в `C:\_Architect-os\dashboard`; `general`/`explore` — только чтение. Предложение: своя `.opencode` в `G:\_Grafik_TO` с L3 и bash-разрешением на `npm --prefix G:\_Grafik_TO ...`.
- GRAFIK-28 (аудит) и GRAFIK-30 (разведка) приняты как документы; исправления по Excel/доступности — отдельными задачами позже.
- Поле `groupWindowDays` теперь ограничено 1–365 (GRAFIK-31 принят, `6b33bb5`).

## Факты об окружении
- Проект: `G:\_Grafik_TO`, публичный репозиторий, сайт https://wwwmanager.github.io/Grafik_TO/ (Pages, deploy по push в main).
- Проверка: `npm --prefix G:\_Grafik_TO run verify` (lint, тесты, сборка).
- Справочник: `public/data/settlements-12.json` (Челябинская, dataId=12, regionCode=74), скрипт `scripts/build-settlements.mjs`, лицензия `public/data/LICENSE-OSM.txt`.
- Политика: в рантайме внешних сервисов нет (кроме `isdayoff.ru` с офлайн-фолбэком); OSM нужен только при сборке данных. Приватность: реальные адреса владельца в репозиторий не попадают.
