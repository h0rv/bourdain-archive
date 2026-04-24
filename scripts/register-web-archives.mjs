#!/usr/bin/env node
/**
 * Build a registry of every known web URL and its archive targets.
 *
 * This does not submit by default. It creates deterministic Wayback lookup/save
 * links so every source has an archive path. Use `--save` later if we want to
 * actually ask archive.org to snapshot missing URLs (throttled).
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

const CONTENT_ROOT = 'src/content';
const ARCHIVE_SOURCES = 'archive/sources.json';
const OUT = 'archive/derived/web-archive-registry.json';
const USER_AGENT = 'bourdain-archive/0.1 web archive registrar';
const SHOULD_SAVE = process.argv.includes('--save');
const SAVE_DELAY_MS = 3000;

function parseYamlUrls(text) {
  const urls = [];
  for (const match of text.matchAll(/^\s*([A-Za-z0-9_]*url):\s*(https?:\/\/\S+)\s*$/gm)) {
    urls.push({ field: match[1], url: match[2].replace(/^['"]|['"]$/g, '') });
  }
  return urls;
}

function collectJsonUrls(value, refs = [], prefix = '') {
  if (typeof value === 'string') {
    if (value.startsWith('http://') || value.startsWith('https://')) refs.push({ field: prefix, url: value });
    return refs;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectJsonUrls(item, refs, `${prefix}[${index}]`));
    return refs;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) collectJsonUrls(child, refs, prefix ? `${prefix}.${key}` : key);
  }
  return refs;
}

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

function archiveTargets(url) {
  const encoded = encodeURI(url);
  return {
    latest_url: `https://web.archive.org/web/2/${encoded}`,
    calendar_url: `https://web.archive.org/web/*/${encoded}`,
    save_url: `https://web.archive.org/save/${encoded}`,
  };
}

function isArchiveUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'web.archive.org' || host === 'archive.org';
  } catch {
    return false;
  }
}

async function contentRefs() {
  const refs = [];
  for (const file of await walk(CONTENT_ROOT)) {
    const ext = extname(file);
    const text = await readFile(file, 'utf8');
    const sourceRefs = ext === '.json' ? collectJsonUrls(JSON.parse(text)) : parseYamlUrls(text);
    for (const ref of sourceRefs) refs.push({ ...ref, owner: file });
  }
  return refs;
}

async function archiveSourceRefs() {
  const sources = JSON.parse(await readFile(ARCHIVE_SOURCES, 'utf8'));
  const refs = [];
  for (const source of sources) {
    for (const key of ['url', 'canonical_url']) {
      if (source[key]) refs.push({ owner: ARCHIVE_SOURCES, field: `${source.id}.${key}`, url: source[key] });
    }
  }
  return refs;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveUrl(url) {
  try {
    const response = await fetch(archiveTargets(url).save_url, {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT },
      redirect: 'manual',
    });
    return { attempted_at: new Date().toISOString(), status: response.status, location: response.headers.get('location') };
  } catch (error) {
    return { attempted_at: new Date().toISOString(), error: error.message };
  }
}

const refs = [...await contentRefs(), ...await archiveSourceRefs()];
const registry = {};
for (const ref of refs) {
  if (!ref.url || isArchiveUrl(ref.url)) continue;
  registry[ref.url] ??= { url: ref.url, ...archiveTargets(ref.url), refs: [] };
  registry[ref.url].refs.push({ owner: ref.owner, field: ref.field });
}

if (SHOULD_SAVE) {
  let count = 0;
  for (const item of Object.values(registry)) {
    count += 1;
    console.log(`${count}/${Object.keys(registry).length} save ${item.url}`);
    item.save = await saveUrl(item.url);
    await sleep(SAVE_DELAY_MS);
  }
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(resolve(OUT), `${JSON.stringify({ generated_at: new Date().toISOString(), count: Object.keys(registry).length, registry }, null, 2)}\n`, 'utf8');
console.log(`registered ${Object.keys(registry).length} web archive targets`);
