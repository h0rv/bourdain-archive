#!/usr/bin/env node
/**
 * Production link audit.
 *
 * This validates every URL-like field in src/content and archive/sources.json.
 * It is separate from preview extraction because non-HTML 2xx links are still
 * valid archive targets even when they cannot produce rich cards.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import YAML from 'yaml';

const CONTENT_ROOT = 'src/content';
const ARCHIVE_SOURCES = 'archive/sources.json';
const OUT = 'archive/derived/link-audit.json';
const USER_AGENT = 'bourdain-archive/0.1 link auditor';
const CONCURRENCY = 6;
const TIMEOUT_MS = 12_000;
const HARD_STATUSES = new Set([404, 410]);
const SOFT_STATUSES = new Set([401, 403, 406, 408, 409, 425, 429, 451, 500, 502, 503, 504]);
const SHOULD_REFRESH = process.argv.includes('--refresh');
const SHOULD_STRICT = process.argv.includes('--strict');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

function collectUrls(value, refs = [], prefix = '') {
  if (typeof value === 'string') {
    if (value.startsWith('http://') || value.startsWith('https://')) refs.push({ field: prefix || 'value', url: value });
    return refs;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUrls(item, refs, `${prefix}[${index}]`));
    return refs;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) collectUrls(child, refs, prefix ? `${prefix}.${key}` : key);
  }
  return refs;
}

async function contentRefs() {
  const refs = [];
  for (const file of await walk(CONTENT_ROOT)) {
    const ext = extname(file);
    if (!['.json', '.yaml', '.yml'].includes(ext)) continue;
    const text = await readFile(file, 'utf8');
    const data = ext === '.json' ? JSON.parse(text) : YAML.parse(text);
    for (const ref of collectUrls(data)) refs.push({ ...ref, owner: file });
  }
  return refs;
}

async function archiveSourceRefs() {
  const refs = [];
  try {
    const sources = JSON.parse(await readFile(ARCHIVE_SOURCES, 'utf8'));
    for (const source of sources) {
      for (const ref of collectUrls(source)) refs.push({ ...ref, owner: ARCHIVE_SOURCES, source_id: source.id });
    }
  } catch {
    // archive/sources.json is optional for downstream forks.
  }
  return refs;
}

async function loadExisting() {
  try {
    const existing = JSON.parse(await readFile(OUT, 'utf8'));
    return existing.links ?? {};
  } catch {
    return {};
  }
}

function classify(result) {
  if (result.ok) return 'ok';
  if (HARD_STATUSES.has(result.status)) return 'hard-fail';
  if (SOFT_STATUSES.has(result.status) || result.error === 'timeout') return 'soft-fail';
  return 'unknown-fail';
}

async function fetchWithTimeout(url, method) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: '*/*',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function auditUrl(url) {
  const started = new Date().toISOString();
  try {
    let response = await fetchWithTimeout(url, 'HEAD');
    if (response.status === 405 || response.status === 403 || response.status === 406 || response.status >= 500) {
      response = await fetchWithTimeout(url, 'GET');
    }
    const result = {
      url,
      final_url: response.url || url,
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      content_type: response.headers.get('content-type') ?? undefined,
      checked_at: started,
    };
    return { ...result, classification: classify(result) };
  } catch (error) {
    const result = {
      url,
      ok: false,
      error: error.name === 'AbortError' ? 'timeout' : error.message,
      checked_at: started,
    };
    return { ...result, classification: classify(result) };
  }
}

async function runQueue(items, worker) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

const refs = [...await contentRefs(), ...await archiveSourceRefs()];
const byUrl = new Map();
for (const ref of refs) {
  const entry = byUrl.get(ref.url) ?? { url: ref.url, refs: [] };
  entry.refs.push({ owner: ref.owner, field: ref.field, source_id: ref.source_id });
  byUrl.set(ref.url, entry);
}

const urls = Array.from(byUrl.keys()).sort();
const existing = await loadExisting();
const currentExisting = Object.fromEntries(Object.entries(existing).filter(([url]) => byUrl.has(url)));
const toAudit = SHOULD_REFRESH ? urls : urls.filter((url) => !currentExisting[url]);
console.log(`link urls: ${urls.length}; auditing: ${toAudit.length}`);

const audited = await runQueue(toAudit, async (url, index) => {
  const result = await auditUrl(url);
  console.log(`${index + 1}/${toAudit.length} ${result.classification}:${result.status ?? result.error} ${url}`);
  return result;
});

const links = { ...currentExisting };
for (const result of audited) links[result.url] = result;
for (const url of urls) links[url].refs = byUrl.get(url)?.refs ?? [];

const summary = Object.values(links).reduce((counts, link) => {
  counts[link.classification] = (counts[link.classification] ?? 0) + 1;
  return counts;
}, {});

await mkdir(dirname(OUT), { recursive: true });
await writeFile(resolve(OUT), `${JSON.stringify({ generated_at: new Date().toISOString(), count: urls.length, summary, links }, null, 2)}\n`, 'utf8');
console.log(`audited ${urls.length} links`, summary);

const hardFailures = Object.values(links).filter((link) => link.classification === 'hard-fail');
const unknownFailures = Object.values(links).filter((link) => link.classification === 'unknown-fail');
if (hardFailures.length > 0 || (SHOULD_STRICT && unknownFailures.length > 0)) {
  process.exitCode = 1;
}
