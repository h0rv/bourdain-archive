#!/usr/bin/env node
/**
 * Lightweight data checks for src/content.
 *
 * Astro validates schemas at build time. This catches archive-specific hygiene:
 * duplicate IDs, missing references, bad URL-looking fields, and date shape drift.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const CONTENT_ROOT = 'src/content';
const COLLECTIONS = ['works', 'episodes', 'appearances', 'literature', 'places', 'people', 'sources'];
const DATE_PRECISIONS = new Set(['day', 'month', 'year', 'unknown']);
const STATUS_VALUES = new Set(['confirmed', 'needs-review', 'missing-source', 'dead-link', 'partial']);
const URL_FIELD_RE = /(^|_)url$/;

const errors = [];
const warnings = [];

function stripQuotes(value) {
  const trimmed = String(value ?? '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineValue(value) {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'null') return null;
  if (trimmed === '[]') return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => stripQuotes(item))
      .filter(Boolean);
  }
  return stripQuotes(trimmed);
}

function parseYamlLite(text) {
  const data = {};
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line.startsWith(' ') || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/);
    if (!match) continue;

    const [, key, rawValue = ''] = match;
    if (rawValue.trim() !== '') {
      data[key] = parseInlineValue(rawValue);
      continue;
    }

    const array = [];
    const object = {};
    let sawArray = false;
    let sawObject = false;
    for (let j = i + 1; j < lines.length; j += 1) {
      const child = lines[j];
      if (!child.startsWith(' ')) break;
      const item = child.match(/^\s+-\s*(.+)$/);
      if (item) {
        sawArray = true;
        array.push(stripQuotes(item[1]));
        continue;
      }
      const prop = child.match(/^\s+([A-Za-z0-9_]+):(?:\s*(.*))?$/);
      if (prop) {
        sawObject = true;
        object[prop[1]] = parseInlineValue(prop[2] ?? '');
      }
    }
    data[key] = sawArray ? array : sawObject ? object : null;
  }

  return data;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function loadCollection(collection) {
  const dir = join(CONTENT_ROOT, collection);
  if (!(await exists(dir))) return [];

  const files = (await readdir(dir)).filter((file) => file.endsWith('.json') || file.endsWith('.yaml') || file.endsWith('.yml'));
  return Promise.all(
    files.map(async (file) => {
      const path = join(dir, file);
      const text = await readFile(path, 'utf8');
      const data = file.endsWith('.json') ? JSON.parse(text) : parseYamlLite(text);
      return { collection, file, path, data };
    }),
  );
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function checkUrl(value, path, field) {
  if (!value) return;
  try {
    new URL(value);
  } catch {
    errors.push(`${path}: invalid URL in ${field}: ${value}`);
  }
}

function collectUrlFields(value, path, prefix = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string' && URL_FIELD_RE.test(key)) checkUrl(child, path, field);
    if (child && typeof child === 'object' && !Array.isArray(child)) collectUrlFields(child, path, field);
  }
}

function checkDate(entry) {
  const { data, path } = entry;
  const precision = data.date_precision ?? 'unknown';
  if (!DATE_PRECISIONS.has(precision)) errors.push(`${path}: invalid date_precision: ${precision}`);
  if (!data.date) return;

  const date = String(data.date);
  const valid =
    precision === 'year' ? /^\d{4}$/.test(date) :
    precision === 'month' ? /^\d{4}-\d{2}$/.test(date) :
    precision === 'day' ? /^\d{4}-\d{2}-\d{2}$/.test(date) :
    true;
  if (!valid) errors.push(`${path}: date ${date} does not match precision ${precision}`);
}

const entries = (await Promise.all(COLLECTIONS.map(loadCollection))).flat();
const byId = new Map();
const byCollection = new Map(COLLECTIONS.map((collection) => [collection, new Map()]));

for (const entry of entries) {
  const { data, path, collection } = entry;
  if (!data.id) errors.push(`${path}: missing id`);
  if (!data.type) errors.push(`${path}: missing type`);
  if (!data.title && !data.name) errors.push(`${path}: missing title/name`);
  if (data.status && !STATUS_VALUES.has(data.status)) errors.push(`${path}: invalid status: ${data.status}`);

  if (data.id) {
    if (collection !== 'sources') {
      if (byId.has(data.id)) errors.push(`${path}: duplicate id ${data.id} also in ${byId.get(data.id).path}`);
      byId.set(data.id, entry);
    }
    byCollection.get(collection)?.set(data.id, entry);
  }

  checkDate(entry);
  collectUrlFields(data, path);
}

for (const entry of entries) {
  const { data, path, collection } = entry;
  if (collection !== 'sources') {
    for (const id of asArray(data.people)) {
      if (!byCollection.get('people')?.has(id)) errors.push(`${path}: missing person ref ${id}`);
    }
    for (const id of asArray(data.places)) {
      if (!byCollection.get('places')?.has(id)) errors.push(`${path}: missing place ref ${id}`);
    }
    for (const id of asArray(data.sources)) {
      if (!byCollection.get('sources')?.has(id)) errors.push(`${path}: missing source ref ${id}`);
    }
    for (const id of asArray(data.related)) {
      if (!byId.has(id)) errors.push(`${path}: missing related ref ${id}`);
    }
  }

  if (!data.date && ['works', 'episodes', 'appearances', 'literature'].includes(collection)) {
    warnings.push(`${path}: undated`);
  }
}

for (const warning of warnings) console.warn(`warn: ${warning}`);
if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`validated ${entries.length} entries (${warnings.length} warnings)`);
}
