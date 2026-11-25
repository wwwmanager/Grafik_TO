# Состояние работ по grafik_to (для продолжения сессии)

Обновлено: 2026-11-25. Источник истины по задачам — `docs/context/slices.json`; по решениям — `docs/spec/decisions.md` (D15–D23).

## Сейчас в работе
- **GRAFIK-39-DATA-CLEANUP** — ПРИНЯТ `c9945b6`: 2164 → 1267 записей (city=4 town=46 village=575 hamlet=642), locality=0, дублей 0, 141 КБ, `npm run verify` зелёный.
- **GRAFIK-36-ALL-REGIONS** — отправлен orch1 2026-11-25 21:21, статус `dispatched`, идёт сборка: 30/89 регионов, ~4 МБ, `public/data/regions.json` + `public/data/settlements/`. Ждём DONE.
- Далее автоматически: 33 → 34 → 35 (dispatchText и dependsOn уже в леджере; владелец делегировал цепочку на ночь).

## Порядок задач (по одной, следующая после приёмки предыдущей)
1. GRAFIK-39 — чистка данных Челябинской области.
2. GRAFIK-36-ALL-REGIONS — справочники всех регионов РФ через тот же скрипт (он должен быть универсальным).
3. GRAFIK-33-ADDR-RESOLVER — разбор адреса, выбор региона/соседних, поиск по справочнику.
4. GRAFIK-34-PHYSICAL-SCHEDULE — маршруты по соседним НП за один день, площадка, строки Excel (D20).
5. GRAFIK-35-PHYSICAL-TAB — вкладка «Физлица», ручные объединения, хранение в браузере.

Тексты заданий 33, 34, 35, 36 уже лежат в леджере. Отправка:
`pwsh C:\Users\User\AppData\Local\Temp\opencode\dispatch-planned.ps1 -Id <id>`
Приёмка: `pwsh C:\Users\User\AppData\Local\Temp\opencode\accept-generic.ps1 -Id <id> -Commit <hash> -Retro "<строка>"`.

## Проверка после GRAFIK-39 (владельцем, 10 мин)
Открыть https://wwwmanager.github.io/Grafik_TO/data/settlements-74.json, найти 10–15 знакомых посёлков, сверить район и координаты на карте OSM. Отдельно: 3–4 у границ районов, дубли названий, «Тайнак/Тундуш → Златоуст».

## Открытые вопросы
- **GRAFIK-21** (руководство) у orch2 (`ses_e358b9c96ffeVwXivNx5cx0Tei`), отчёта нет. В рабочем дереве незакоммичены `package.json` (там `docx`, должно уйти в devDependencies), `package-lock.json`, `docs/manual_new.docx`, `*.bak`, `~$manual.docx` — при приёмке убрать библиотеку из основных зависимостей и удалить временные файлы.
- **L3 для grafik_to** — решение владельца не получено. Причина: единственный пишущий L3 (`l3-nemotron`) может писать только в `C:\_Architect-os\dashboard`; `general`/`explore` — только чтение. Предложение: своя `.opencode` в `G:\_Grafik_TO` с L3 и bash-разрешением на `npm --prefix G:\_Grafik_TO ...`.
- GRAFIK-28 (аудит) и GRAFIK-30 (разведка) приняты как документы; исправления по Excel/доступности — отдельными задачами позже.
- Поле `groupWindowDays` теперь ограничено 1–365 (GRAFIK-31 принят, `6b33bb5`).

## Факты об окружении
- Проект: `G:\_Grafik_TO`, публичный репозиторий, сайт https://wwwmanager.github.io/Grafik_TO/ (Pages, deploy по push в main).
- Проверка: `npm --prefix G:\_Grafik_TO run verify` (lint, тесты, сборка).
- Справочник: `public/data/settlements-74.json` (249 КБ), скрипт `scripts/build-settlements.mjs`, лицензия `public/data/LICENSE-OSM.txt`.
- Политика: в рантайме внешних сервисов нет (кроме `isdayoff.ru` с офлайн-фолбэком); OSM нужен только при сборке данных. Приватность: реальные адреса владельца в репозиторий не попадают.
