# Grafik_TO — Project Context

**Project ID:** `grafik_to`
**Root:** `G:\_Grafik_TO`
**Architect port:** 22602
**Orchestrator ports:** 28603 (orch1), 28604 (orch2)
**Owner:** L0 direct (no separate L1)

## Purpose
Браузерное статическое веб-приложение для формирования годового графика технического осмотра
самоходной техники по выгрузке из реестра (Excel). Обработка только на клиенте, без утечки данных.

## Tech Stack
- Vite + Vanilla JS (ES-модули), собирается в статику `dist/` для GitHub Pages
- Чистый CSS с дизайн-токенами (`src/styles/tokens.css`)
- SheetJS (`xlsx`, тарбол с cdn.sheetjs.com) — чтение `.xlsx`/`.xls`
- ExcelJS — экспорт оформленного `.xlsx`
- Тесты: Vitest; линт: ESLint (flat config); форматирование: Prettier

## Repository Layout
```
G:\_Grafik_TO\
├── index.html
├── package.json
├── vite.config.js
├── eslint.config.js
├── src/
│   ├── main.js
│   ├── styles/        # tokens.css, main.css
│   └── modules/       # parser, calendarService, scheduler, exporter, ui
├── public/calendar/   # fallback production-calendar JSON (later slice)
├── tests/             # Vitest
├── .github/workflows/ # deploy.yml (GitHub Pages)
└── docs/
    ├── context/       # this INDEX.md + slices.json
    └── spec/TZ.md     # authoritative spec

## Commands
```powershell
npm install
npm run dev
npm run build
npm run test
npm run lint
npm run verify   # lint + test + build
```

## Privacy
Обработка Excel — строго в браузере. Единственный сетевой запрос — `https://isdayoff.ru`
(производственный календарь), закреплён в CSP `index.html`.

## Active Work
- **Status:** каркас (scaffold) создан
- **Next:** парсер Excel, календарь, планировщик (по `docs/spec/TZ.md`)

## Registry
Machine-local registry: `~/.architect-os/registry/grafik_to.json`
Portfolio entry: `~/.architect-os/projects.json` (id: `grafik_to`)

---
*This file is the canonical context entrypoint for L0 resume (ADR-014).*
*Marker: `ARCHOS-RESUME-CONTEXT-CONTRACT-20261108`*