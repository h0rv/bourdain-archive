#!/usr/bin/env node
/**
 * Promote curated literature metadata from archive/derived into src/content.
 *
 * archive/derived/literature-about-bourdain.json is the source snapshot we edit/import.
 * src/content/literature/*.yaml is the curated site-facing projection.
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';

const SOURCE = 'archive/derived/literature-about-bourdain.json';
const OUT_DIR = 'src/content/literature';
const SOURCES_DIR = 'src/content/sources';
const DEATH_DATE = '2018-06-08';

function stringifyYaml(value) {
  return YAML.stringify(value, { lineWidth: 0 }).replace(/^(date|accessed): (\d{4}(?:-\d{2})?(?:-\d{2})?)$/gm, '$1: "$2"');
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.replace(/^www\./, '');
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value;
  }
}

function slugify(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function inferDate(url) {
  for (const pattern of [/\/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\/|$)/, /\/(\d{4})-(\d{1,2})-(\d{1,2})(?:\/|$)/]) {
    const match = url.match(pattern);
    if (match) {
      const [, year, month, day] = match;
      return { date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`, date_precision: 'day' };
    }
  }

  const month = url.match(/\/(\d{4})\/(\d{1,2})(?:\/|$)/);
  if (month) return { date: `${month[1]}-${month[2].padStart(2, '0')}`, date_precision: 'month' };

  const year = url.match(/\/(19\d{2}|20\d{2})(?:\/|$|-)/);
  if (year) return { date: year[1], date_precision: 'year' };

  return { date: null, date_precision: 'unknown' };
}

function isPosthumous(date, precision) {
  if (!date) return false;
  if (precision === 'year') return date > '2018';
  if (precision === 'month') return date > '2018-06';
  return date >= DEATH_DATE;
}

function mediaTypeFor(type) {
  return type === 'interview' ? 'interview-talk' : 'article-essay';
}

function inferType(bucket) {
  const normalized = bucket.toLowerCase();
  if (normalized.includes('interview')) return 'interview';
  if (normalized.includes('review')) return 'review';
  if (normalized.includes('obit')) return 'obit';
  if (normalized.includes('tribute') || normalized.includes('remembrance') || normalized.includes('memorial')) return 'tribute';
  if (normalized.includes('profile')) return 'profile';
  if (normalized.includes('essay') || normalized.includes('analysis') || normalized.includes('legacy') || normalized.includes('commentary')) return 'essay';
  return 'article';
}

async function loadSourceMap() {
  const byUrl = new Map();
  for (const file of await readdir(SOURCES_DIR)) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml') && !file.endsWith('.json')) continue;
    const text = await readFile(join(SOURCES_DIR, file), 'utf8');
    const source = file.endsWith('.json') ? JSON.parse(text) : YAML.parse(text);
    if (source.url) byUrl.set(source.url, source);
    if (source.url) byUrl.set(canonicalUrl(source.url), source);
  }
  return byUrl;
}

function entryFromRecord(record, id, sourceByUrl) {
  const inferredDate = inferDate(record.url);
  const source = sourceByUrl.get(record.url) ?? sourceByUrl.get(canonicalUrl(record.url));
  const date = inferredDate.date ?? source?.date ?? null;
  const date_precision = inferredDate.date_precision !== 'unknown' ? inferredDate.date_precision : source?.date_precision ?? 'unknown';
  const bucketTag = slugify(record.bucket);
  const tags = ['about-bourdain', 'literature', bucketTag];
  if (isPosthumous(date, date_precision)) tags.push('posthumous');

  const type = inferType(record.bucket);
  return {
    id,
    title: record.title,
    type,
    record_type: 'literature',
    media_type: mediaTypeFor(type),
    relation_to_bourdain: 'about',
    date,
    date_precision,
    publication: record.publication,
    bucket: record.bucket,
    tags: Array.from(new Set(tags)),
    people: ['anthony-bourdain'],
    places: [],
    sources: source?.id ? [source.id] : [],
    related: [],
    status: source?.id ? 'confirmed' : 'needs-review',
    availability: {
      official_url: record.url,
      archive_url: null,
      library_url: null,
      audio_url: null,
      video_url: null,
      transcript_url: null,
      streaming_url: null,
      purchase_url: null,
    },
  };
}

async function main() {
  const source = JSON.parse(await readFile(SOURCE, 'utf8'));
  const sourceByUrl = await loadSourceMap();
  const seen = new Set();
  const entries = source.records.map((record) => {
    let id = slugify(`${record.title}-${record.publication}`);
    const base = id;
    let count = 2;
    while (seen.has(id)) id = `${base}-${count++}`;
    seen.add(id);
    return entryFromRecord(record, id, sourceByUrl);
  });

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  await Promise.all(entries.map((entry) => writeFile(join(OUT_DIR, `${entry.id}.yaml`), stringifyYaml(entry))));

  const files = await readdir(OUT_DIR);
  console.log(`wrote ${files.length} literature entries`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
