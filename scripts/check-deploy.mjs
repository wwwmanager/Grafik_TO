#!/usr/bin/env node
// GRAFIK-46: read-only deploy check.
//
// Verifies the live GitHub Pages build: the deployed index.html must be
// reachable and every assets/* reference in it must return HTTP 200. Also
// asserts that every asset referenced by the local dist/index.html exists on
// disk, so a broken build is caught before it is pushed.
//
// Usage:
//   npm run build
//   node scripts/check-deploy.mjs [--url https://host/path/] [--dist dist]
//
// Exit code 1 on a non-200 deployed asset, a missing dist file, or an
// unreachable index.

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_URL = 'https://wwwmanager.github.io/Grafik_TO/';

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function normalizeBase(raw) {
  const url = new URL(raw);
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function extractAssetRefs(html) {
  const refs = new Set();
  const attributeRe = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attributeRe.exec(html)) !== null) {
    const ref = match[1].trim();
    if (/(^|\/)assets\//.test(ref)) refs.add(ref);
  }
  return [...refs];
}

async function probe(url) {
  const separator = url.includes('?') ? '&' : '?';
  const busted = `${url}${separator}v=${Date.now()}`;
  const attempts = [
    { method: 'HEAD' },
    { method: 'GET', headers: { Range: 'bytes=0-0' } },
  ];
  for (const attempt of attempts) {
    try {
      const response = await fetch(busted, {
        ...attempt,
        redirect: 'follow',
        cache: 'no-store',
      });
      if (attempt.method === 'GET' && response.body && typeof response.body.cancel === 'function') {
        await response.body.cancel();
      }
      if (response.status === 405 || response.status === 501) continue;
      return { status: response.status, url: response.url };
    } catch (error) {
      return { status: 0, url, error: String(error?.message || error) };
    }
  }
  return { status: 0, url, error: 'HEAD and GET both unsupported' };
}

const rows = [];
const failures = [];

function record(status, kind, target, detail = '') {
  rows.push({ status, kind, target, detail });
  if (status === 'FAIL') failures.push(`${kind}: ${target} — ${detail}`.trim());
}

function shortTarget(value, limit = 74) {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

async function checkDeployed(baseUrl) {
  const indexUrl = `${baseUrl}?v=${Date.now()}`;
  let html;
  try {
    const response = await fetch(indexUrl, { cache: 'no-store', redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    html = await response.text();
    record('PASS', 'index', shortTarget(baseUrl), `${response.status}`);
  } catch (error) {
    record('FAIL', 'index', shortTarget(baseUrl), String(error?.message || error));
    return [];
  }

  const refs = extractAssetRefs(html);
  if (refs.length === 0) {
    record('FAIL', 'index', shortTarget(baseUrl), 'no assets/* references found');
    return refs;
  }
  for (const ref of refs) {
    const target = new URL(ref, baseUrl).toString();
    const result = await probe(target);
    const detail = result.status === 200 ? '200' : result.error || `HTTP ${result.status}`;
    record(result.status === 200 ? 'PASS' : 'FAIL', 'asset', shortTarget(target), detail);
  }
  return refs;
}

async function checkDist(distDir) {
  const indexPath = path.join(distDir, 'index.html');
  let html;
  try {
    html = await readFile(indexPath, 'utf8');
  } catch {
    record('FAIL', 'dist', indexPath, 'dist/index.html missing — run npm run build');
    return [];
  }
  const refs = extractAssetRefs(html);
  for (const ref of refs) {
    const relative = ref.replace(/^\.?\//, '').split(/[?#]/)[0];
    const filePath = path.join(distDir, relative);
    try {
      const info = await stat(filePath);
      record(
        info.size > 0 ? 'PASS' : 'FAIL',
        'dist',
        shortTarget(relative),
        info.size > 0 ? `${info.size} bytes` : 'empty file',
      );
    } catch {
      record('FAIL', 'dist', shortTarget(relative), 'referenced in dist/index.html but missing');
    }
  }
  return refs.map((ref) => ref.replace(/^\.?\//, ''));
}

function printTable() {
  const widths = {
    status: Math.max(6, ...rows.map((row) => row.status.length)),
    kind: Math.max(4, ...rows.map((row) => row.kind.length)),
  };
  const line = `-${'-'.repeat(widths.status)}-|-${'-'.repeat(widths.kind)}-|${'-'.repeat(76)}`;
  console.log(line);
  console.log(
    `${'STATUS'.padEnd(widths.status)} | ${'KIND'.padEnd(widths.kind)} | TARGET (detail)`,
  );
  console.log(line);
  for (const row of rows) {
    console.log(
      `${row.status.padEnd(widths.status)} | ${row.kind.padEnd(widths.kind)} | ${row.target} (${row.detail})`,
    );
  }
  console.log(line);
}

const baseUrl = normalizeBase(argValue('--url', DEFAULT_URL));
const distDir = path.resolve(argValue('--dist', 'dist'));

console.log(`check-deploy: ${baseUrl}`);
console.log(`check-deploy: dist=${distDir}`);

const deployedRefs = await checkDeployed(baseUrl);
const distRefs = await checkDist(distDir);

if (deployedRefs.length > 0 && distRefs.length > 0) {
  const deployedNames = deployedRefs
    .map((ref) => ref.split(/[?#]/)[0].split('/').pop())
    .sort()
    .join(',');
  const distNames = distRefs
    .map((ref) => ref.split('/').pop())
    .sort()
    .join(',');
  if (deployedNames === distNames) {
    record('PASS', 'match', 'deployed index assets == dist index assets');
  } else {
    record('WARN', 'match', 'deployed index != local dist', 'live HTML is from another build');
  }
}

printTable();

if (failures.length > 0) {
  console.error(`\nFAIL: ${failures.length} problem(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nPASS: deployed index and every referenced asset are reachable; dist is consistent.');
