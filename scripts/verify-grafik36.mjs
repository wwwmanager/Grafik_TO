#!/usr/bin/env node
// GRAFIK-36/40 independent acceptance check (read-only)
// Run: node scripts/verify-grafik36.mjs

import fs from 'fs';
import path from 'path';

const ROOT = 'G:/_Grafik_TO';
const REGIONS_PATH = path.join(ROOT, 'public/data/regions.json');
const SETTLEMENTS_DIR = path.join(ROOT, 'public/data/settlements');

// Classic 85 federal subjects (pre-2014 borders + Sevastopol + Crimea) - deduped
const CLASSIC_SUBJECTS = [
  'Алтай', 'Амурская', 'Архангельская', 'Астраханская', 'Белгородская', 'Брянская',
  'Владимирская', 'Волгоградская', 'Вологодская', 'Воронежская', 'Еврейская АО',
  'Забайкальский', 'Ивановская', 'Иркутская', 'Кабардино-Балкарская', 'Калининградская',
  'Калмыкия', 'Калужская', 'Камчатский', 'Карачаево-Черкесская', 'Кемеровская',
  'Кировская', 'Костромская', 'Краснодарский', 'Красноярский', 'Курганская',
  'Курская', 'Ленинградская', 'Липецкая', 'Магаданская', 'Москва', 'Московская',
  'Мурманская', 'Ненецкий АО', 'Нижегородская', 'Новгородская', 'Новосибирская',
  'Омская', 'Оренбургская', 'Орловская', 'Пензенская', 'Пермский', 'Приморский',
  'Псковская', 'Ростовская', 'Рязанская', 'Самарская', 'Саратовская', 'Сахалинская',
  'Свердловская', 'Смоленская', 'Ставропольский', 'Тамбовская', 'Тверская', 'Томская',
  'Тульская', 'Тюменская', 'Ульяновская', 'Челябинская', 'Читинская', 'Чукотский АО',
  'Ямало-Ненецкий АО', 'Ярославская', 'Адыгея', 'Башкортостан', 'Бурятия',
  'Дагестан', 'Ингушетия', 'Кабардино-Балкария', 'Калмыкия', 'Карачаево-Черкесия',
  'Карелия', 'Коми', 'Крым', 'Марий Эл', 'Мордовия', 'Саха (Якутия)', 'Северная Осетия',
  'Татарстан', 'Тыва', 'Удмуртия', 'Хакасия', 'Чечня', 'Чувашия', 'Севастополь'
].map(s => s.toLowerCase());

const OPTIONAL_SUBJECTS = [
  'ДНР', 'ЛНР', 'Запорожская', 'Херсонская'
].map(s => s.toLowerCase());

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function check1_regions(regions) {
  const codes = new Set();
  const isos = new Set();
  const names = new Set();
  const dupes = { code: [], iso: [], name: [] };
  for (const r of regions) {
    if (codes.has(r.code)) dupes.code.push(r.code);
    else codes.add(r.code);
    if (isos.has(r.iso)) dupes.iso.push(r.iso);
    else isos.add(r.iso);
    if (names.has(r.name)) dupes.name.push(r.name);
    else names.add(r.name);
  }
  const has74 = regions.some(r => r.code === '74' && r.name === 'Челябинская область');
  const subjectCount = regions.length;
  const legacy = ['83','86','89','91','95'].filter(c => codes.has(c));
  return {
    pass: dupes.code.length === 0 && dupes.iso.length === 0 && dupes.name.length === 0 && has74 && subjectCount >= 83 && legacy.length === 0,
    dupes, has74, subjectCount, legacy, total: regions.length
  };
}

function check2_index_files(regions) {
  const files = fs.readdirSync(SETTLEMENTS_DIR).filter(f => f.endsWith('.json'));
  const indexed = new Set(regions.map(r => r.file));
  const missingFiles = files.filter(f => !indexed.has(f));
  const missingIndex = [...indexed].filter(f => !files.includes(f));
  const countMatch = [];
  const bytesMatch = [];
  for (const r of regions) {
    const fp = path.join(SETTLEMENTS_DIR, r.file);
    if (!fs.existsSync(fp)) { countMatch.push({file: r.file, ok: false}); continue; }
    const data = readJson(fp);
    const actualCount = data.length;
    const actualBytes = fs.statSync(fp).size;
    countMatch.push({file: r.file, ok: actualCount === r.count, expected: r.count, actual: actualCount});
    bytesMatch.push({file: r.file, ok: actualBytes === r.bytes, expected: r.bytes, actual: actualBytes});
  }
  return {
    pass: missingFiles.length === 0 && missingIndex.length === 0 && countMatch.every(x => x.ok) && bytesMatch.every(x => x.ok),
    missingFiles, missingIndex, countMatch, bytesMatch
  };
}

function check3_counts(regions) {
  const zero = regions.filter(r => r.count === 0);
  const low = regions.filter(r => r.count > 0 && r.count < 200);
  return {
    pass: zero.length === 0 && low.length === 0,
    zero: zero.map(r => r.code),
    low: low.map(r => ({code: r.code, count: r.count}))
  };
}

function check4_files(regions) {
  const results = [];
  for (const r of regions) {
    const fp = path.join(SETTLEMENTS_DIR, r.file);
    if (!fs.existsSync(fp)) { results.push({file: r.file, ok: false, reason: 'missing'}); continue; }
    const data = readJson(fp);
    let hasLocality = false;
    let junk = 0;
    const seen = new Set();
    let dup3dec = 0;
    for (const d of data) {
      if (d.type === 'locality') hasLocality = true;
      const n = d.name.toLowerCase();
      if (/^\d/.test(n) || /^ст\.|^рп\.|^ж\./.test(n) || /^\d+\s*км/.test(n) || /^(снт|днт|жк|кв|ул|пр)\b/.test(n)) junk++;
      const key = `${d.name.toLowerCase()}|${d.municipality.toLowerCase()}|${Number(d.lat).toFixed(3)}|${Number(d.lon).toFixed(3)}`;
      if (seen.has(key)) dup3dec++;
      seen.add(key);
    }
    let spot = {pass: true, details: ''};
    if (r.code === '74') {
      const spotChecks = [
        {name: 'Сатка', muni: 'Саткинский'},
        {name: 'Бердяуш', muni: 'Саткинский'},
        {name: 'Тайнак', muni: 'Златоуст'},
        {name: 'Тундуш', muni: 'Златоуст'},
        {name: 'Тюбук', muni: 'Каслинский'},
        {name: 'Магнитка', muni: 'Кусинский'},
      ];
      const failures = [];
      for (const sc of spotChecks) {
        const found = data.find(d => d.name === sc.name && d.municipality === sc.muni);
        if (!found) failures.push(`${sc.name}/${sc.muni} NOT FOUND`);
      }
      spot = {pass: failures.length === 0, details: failures.join('; ')};
    }
    results.push({file: r.file, ok: !hasLocality && junk === 0 && dup3dec === 0 && spot.pass, hasLocality, junk, dup3dec, spot});
  }
  return {pass: results.every(r => r.ok), results};
}

function check5_cross_file_overlap(regions) {
  // Build (name|municipality) pairs per region
  const regionPairs = new Map();
  for (const r of regions) {
    const fp = path.join(SETTLEMENTS_DIR, r.file);
    if (!fs.existsSync(fp)) continue;
    const data = readJson(fp);
    const pairs = new Set(data.map(d => `${d.name.toLowerCase()}|${d.municipality.toLowerCase()}`));
    regionPairs.set(r.code, pairs);
  }
  const codes = [...regionPairs.keys()];
  const violations = [];
  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      const a = regionPairs.get(codes[i]);
      const b = regionPairs.get(codes[j]);
      if (a.size === 0 || b.size === 0) continue;
      let overlap = 0;
      for (const p of a) if (b.has(p)) overlap++;
      const pct = overlap / Math.min(a.size, b.size);
      if (pct > 0.5) {
        violations.push({a: codes[i], b: codes[j], overlap, pct: (pct * 100).toFixed(1)});
      }
    }
  }
  return {
    pass: violations.length === 0,
    violations,
    checked: codes.length
  };
}

function check6_municipality_uniqueness(regions) {
  const results = [];
  for (const r of regions) {
    const fp = path.join(SETTLEMENTS_DIR, r.file);
    if (!fs.existsSync(fp)) { results.push({file: r.file, ok: false, reason: 'missing'}); continue; }
    const data = readJson(fp);
    const muniCounts = new Map();
    for (const d of data) {
      const key = d.municipality.toLowerCase();
      muniCounts.set(key, (muniCounts.get(key) || 0) + 1);
    }
    const dupes = [...muniCounts.entries()].filter(([,c]) => c > 1).map(([m]) => m);
    results.push({file: r.file, ok: dupes.length === 0, dupes, totalMunis: muniCounts.size});
  }
  return {pass: results.every(r => r.ok), results};
}

function check7_missing_subjects(regions) {
  const present = new Set(regions.map(r => r.name.toLowerCase()));
  const missingClassic = CLASSIC_SUBJECTS.filter(s => !present.has(s));
  const missingOptional = OPTIONAL_SUBJECTS.filter(s => !present.has(s));
  return {
    pass: missingClassic.length === 0,
    missingClassic,
    missingOptional,
    expectedClassic: CLASSIC_SUBJECTS.length,
    expectedOptional: OPTIONAL_SUBJECTS.length,
    present: present.size
  };
}

async function main() {
  const raw = readJson(REGIONS_PATH);
  const regions = raw.regions ?? raw;
  const c1 = check1_regions(regions);
  const c2 = check2_index_files(regions);
  const c3 = check3_counts(regions);
  const c4 = check4_files(regions);
  const c5 = check5_cross_file_overlap(regions);
  const c6 = check6_municipality_uniqueness(regions);
  const c7 = check7_missing_subjects(regions);

  console.log(`CHECK1 regions.json: ${c1.pass ? 'PASS' : 'FAIL'} | subjects=${c1.subjectCount} | has74=${c1.has74} | legacy=${c1.legacy.length} | dupes=${c1.dupes.code.length}/${c1.dupes.iso.length}/${c1.dupes.name.length}`);
  console.log(`CHECK2 index<->files: ${c2.pass ? 'PASS' : 'FAIL'} | missingFiles=${c2.missingFiles.length} | missingIndex=${c2.missingIndex.length} | countMismatch=${c2.countMatch.filter(x=>!x.ok).length} | bytesMismatch=${c2.bytesMatch.filter(x=>!x.ok).length}`);
  console.log(`CHECK3 counts: ${c3.pass ? 'PASS' : 'FAIL'} | zero=${c3.zero.length} (${c3.zero.join(',')}) | low<200=${c3.low.length} (${c3.low.map(x=>x.code+':'+x.count).join(', ')})`);
  console.log(`CHECK4 per-file: ${c4.pass ? 'PASS' : 'FAIL'} | hasLocality=${c4.results.filter(r=>r.hasLocality).length} | junk=${c4.results.reduce((s,r)=>s+r.junk,0)} | dup3dec=${c4.results.reduce((s,r)=>s+r.dup3dec,0)} | spot74=${c4.results.find(r=>r.file==='74.json')?.spot.pass ? 'PASS' : 'FAIL'}`);
  console.log(`CHECK5 cross-file overlap: ${c5.pass ? 'PASS' : 'FAIL'} | violations=${c5.violations.length} (${c5.violations.map(v=>v.a+'-'+v.b+':'+v.pct+'%').join('; ')})`);
  console.log(`CHECK6 muni uniqueness: ${c6.pass ? 'PASS' : 'FAIL'} | violators=${c6.results.filter(r=>!r.ok).length} (${c6.results.filter(r=>!r.ok).map(r=>r.file+':'+(r.dupes?.length||0)).join('; ')})`);
  console.log(`CHECK7 missing subjects (classic 85): ${c7.pass ? 'PASS' : 'FAIL'} | missing=${c7.missingClassic.length}/${c7.expectedClassic} (${c7.missingClassic.slice(0,10).join(', ')}${c7.missingClassic.length>10?'...':''}) | optional 4: missing=${c7.missingOptional.length}/${c7.expectedOptional} (${c7.missingOptional.join(', ')})`);
  console.log(`CHECK8 test delta: TODO (run npm test before/after)`);

  const allPass = c1.pass && c2.pass && c3.pass && c4.pass && c5.pass && c6.pass && c7.pass;
  process.exit(allPass ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });