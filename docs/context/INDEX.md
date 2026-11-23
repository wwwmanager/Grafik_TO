# Grafik_TO — Project Context

**Project ID:** `grafik_to`
**Root:** `G:\_Grafik_TO`
**Architect port:** 22602
**Orchestrator ports:** 28603 (orch1), 28604 (orch2)
**Owner:** L0 direct (no separate L1)

## Purpose
[Тут описать назначение проекта: что делает, для чего нужен]

## Tech Stack
- C++17, CMake 3.20+
- Qt 5.15 (Widgets, PrintSupport, Svg)
- MinGW (Windows 7 SP1+ target)
- Inno Setup 6.x for installer

## Repository Layout
```
G:\_Grafik_TO\
├── CMakeLists.txt
├── src/           # .cpp
├── include/       # .hpp
├── resources/     # .qrc, icons, themes, fonts
├── tests/         # unit/integration tests
├── scripts/       # build/install scripts
└── docs/
    ├── context/   # this INDEX.md + slice specs
    └── adr/       # architecture decisions
```

## Build
```powershell
cmake -B build -DCMAKE_BUILD_TYPE=Release -G "MinGW Makefiles"
cmake --build build --config Release --target grafik_to
ctest --test-dir build --output-on-failure
```

## Active Work
- **Status:** Initializing project structure
- **Next:** Define first feature slice, write spec in `docs/context/slices/`

## Key Decisions (ADR)
[Ссылки на ADR файлы в docs/adr/ по мере появления]

## Registry
Machine-local registry: `~/.architect-os/registry/grafik_to.json`
Portfolio entry: `~/.architect-os/projects.json` (id: `grafik_to`)

---
*This file is the canonical context entrypoint for L0 resume (ADR-014).*
*Marker: `ARCHOS-RESUME-CONTEXT-CONTRACT-20261108`*