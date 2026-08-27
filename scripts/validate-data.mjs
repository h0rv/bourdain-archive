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
const COLLECTIONS = ['works', 'series', 'appearances', 'screen', 'literature', 'events', 'places', 'people', 'images', 'sources'];
const DATE_PRECISIONS = new Set(['day', 'month', 'year', 'unknown']);
const STATUS_VALUES = new Set(['confirmed', 'needs-review', 'missing-source', 'dead-link', 'partial']);
const INDEX_MODES = new Set(['rollup', 'child', 'hidden']);
const URL_FIELD_RE = /(^|_)url$/;
const CORE_SOURCE_REQUIRED_COLLECTIONS = new Set(['works', 'series', 'appearances', 'screen', 'literature']);

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

  async function listFiles(root) {
    const names = await readdir(root);
    const nested = await Promise.all(names.map(async (name) => {
      const path = join(root, name);
      const details = await stat(path);
      if (details.isDirectory()) return listFiles(path);
      return path;
    }));
    return nested.flat();
  }

  const files = (await listFiles(dir)).filter((file) => file.endsWith('.json') || file.endsWith('.yaml') || file.endsWith('.yml'));
  return Promise.all(
    files.map(async (file) => {
      const path = file;
      const text = await readFile(path, 'utf8');
      const data = file.endsWith('.json') ? JSON.parse(text) : parseYamlLite(text);
      return { collection, file: file.slice(dir.length + 1), path, data };
    }),
  );
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function checkUrl(value, path, field) {
  if (!value) return;
  if (String(value).startsWith('/')) return;
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

function isExactEpisodeReference(value) {
  if (!value) return false;
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, '');
  const pathname = url.pathname.replace(/\/+$/, '');

  if (host === 'themoviedb.org') {
    return /^\/tv\/\d+(?:-[^/]+)?\/season\/\d+\/episode\/\d+$/.test(pathname);
  }
  if (host === 'imdb.com') return /^\/title\/tt\d+$/.test(pathname);
  if (host === 'thetvdb.com') return /^\/episodes\/\d+$/.test(pathname);
  return false;
}

function isGenericEpisodeAction(value) {
  if (!value) return false;
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, '');
  const pathname = url.pathname.replace(/\/+$/, '');

  if (host === 'wikipedia.org' || host.endsWith('.wikipedia.org')) return true;
  if (host === 'thetvdb.com' && (pathname.includes('/allseasons/') || pathname.endsWith('/seasons/all'))) return true;
  if (host === 'themoviedb.org' && !pathname.includes('/episode/')) return true;
  if (host === 'imdb.com' && !/^\/title\/tt\d+$/.test(pathname)) return true;
  return false;
}

function checkEpisodeActions(entry) {
  const { data, path, collection } = entry;
  if (collection !== 'series' || data.type !== 'episode') return;

  const availability = data.availability ?? {};
  const exactAction =
    availability.official_url ??
    availability.reference_url ??
    availability.archive_url ??
    availability.video_url ??
    availability.streaming_url;

  if (!exactAction) {
    errors.push(`${path}: episode requires an exact public episode action`);
    return;
  }

  if (availability.reference_url && !isExactEpisodeReference(availability.reference_url)) {
    errors.push(`${path}: availability.reference_url must identify one exact episode`);
  }

  const referenceUrl = availability.reference_url ? new URL(availability.reference_url) : undefined;
  const referenceHost = referenceUrl?.hostname.replace(/^www\./, '');
  const tmdbIdentifier = data.identifiers?.tmdb;
  const tmdbMatch = String(tmdbIdentifier ?? '').match(/^tv:(\d+):s(\d+):e(\d+)$/);
  const imdbIdentifier = data.identifiers?.imdb;
  const imdbMatch = String(imdbIdentifier ?? '').match(/^tt\d+$/);

  if (!tmdbMatch && !imdbMatch) {
    errors.push(`${path}: episode requires a canonical TMDB tuple or IMDb title identifier`);
  }
  if (tmdbMatch) {
    const [, , season, episode] = tmdbMatch;
    if (Number(season) !== Number(data.season) || Number(episode) !== Number(data.episode)) {
      errors.push(`${path}: identifiers.tmdb season/episode does not match the record`);
    }
    if (referenceHost === 'themoviedb.org') {
      const urlMatch = new URL(availability.reference_url).pathname.match(/^\/tv\/(\d+)(?:-[^/]+)?\/season\/(\d+)\/episode\/(\d+)$/);
      if (!urlMatch || urlMatch[1] !== tmdbMatch[1] || urlMatch[2] !== season || urlMatch[3] !== episode) {
        errors.push(`${path}: identifiers.tmdb does not match availability.reference_url`);
      }
    }
  }
  if (referenceHost === 'imdb.com') {
    const urlIdentifier = referenceUrl.pathname.match(/^\/title\/(tt\d+)\/?$/)?.[1];
    if (!imdbMatch || urlIdentifier !== imdbIdentifier) {
      errors.push(`${path}: identifiers.imdb does not match availability.reference_url`);
    }
  }

  for (const [field, value] of Object.entries(availability)) {
    if (value && isGenericEpisodeAction(value)) {
      errors.push(`${path}: ${field} is a generic series or season URL, not an episode action`);
    }
  }
}

function checkScreenOfficialAction(entry) {
  const { data, path, collection } = entry;
  const value = data.availability?.official_url;
  if (collection !== 'screen' || !value) return;

  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, '');
  const researchHosts = new Set([
    'imdb.com',
    'metacritic.com',
    'rottentomatoes.com',
    'wikipedia.org',
    'interviews.televisionacademy.com',
  ]);
  if (researchHosts.has(host) || host.endsWith('.wikipedia.org')) {
    errors.push(`${path}: availability.official_url is a research source, not the screen work's official page`);
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
const sourceUrlOwners = new Map();
const confirmedWithoutSources = new Map();
const episodeKeyOwners = new Map();

for (const entry of entries) {
  const { data, path, collection } = entry;
  if (!data.id) errors.push(`${path}: missing id`);
  if (!data.type) errors.push(`${path}: missing type`);
  if (!data.title && !data.name) errors.push(`${path}: missing title/name`);
  if (data.status && !STATUS_VALUES.has(data.status)) errors.push(`${path}: invalid status: ${data.status}`);
  if (data.index_mode && !INDEX_MODES.has(data.index_mode)) errors.push(`${path}: invalid index_mode: ${data.index_mode}`);

  if (data.id) {
    if (collection !== 'sources') {
      if (byId.has(data.id)) errors.push(`${path}: duplicate id ${data.id} also in ${byId.get(data.id).path}`);
      byId.set(data.id, entry);
    }
    const collectionEntries = byCollection.get(collection);
    if (collectionEntries?.has(data.id)) {
      errors.push(`${path}: duplicate ${collection} id ${data.id} also in ${collectionEntries.get(data.id).path}`);
    }
    collectionEntries?.set(data.id, entry);
  }

  if (collection === 'sources' && data.url) {
    const owner = sourceUrlOwners.get(data.url);
    if (owner) errors.push(`${path}: duplicate source URL ${data.url} also in ${owner}`);
    else sourceUrlOwners.set(data.url, path);
  }

  if (collection === 'series' && data.type === 'episode' && data.show && data.season != null && data.episode != null) {
    const episodeKey = `${String(data.show).trim().toLowerCase()}|${data.season}|${data.episode}`;
    const owner = episodeKeyOwners.get(episodeKey);
    if (owner) errors.push(`${path}: duplicate show/season/episode key ${episodeKey} also in ${owner}`);
    else episodeKeyOwners.set(episodeKey, path);
  }

  checkDate(entry);
  checkEpisodeActions(entry);
  checkScreenOfficialAction(entry);
  collectUrlFields(data, path);
}

for (const entry of entries) {
  const { data, path, collection } = entry;
  const defaultIndexMode = collection === 'sources' ? 'hidden' : data.parent_id ? 'child' : 'rollup';
  const indexMode = data.index_mode ?? defaultIndexMode;

  if (data.parent_id && !byId.has(data.parent_id)) errors.push(`${path}: missing parent_id ref ${data.parent_id}`);
  if (indexMode === 'rollup' && data.parent_id) errors.push(`${path}: rollup record cannot also have parent_id ${data.parent_id}`);

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
    for (const id of asArray(data.images)) {
      if (!byCollection.get('images')?.has(id)) errors.push(`${path}: missing image ref ${id}`);
    }
    for (const id of asArray(data.related)) {
      if (!byId.has(id)) errors.push(`${path}: missing related ref ${id}`);
    }

    if (data.status === 'confirmed' && asArray(data.sources).length === 0) {
      if (CORE_SOURCE_REQUIRED_COLLECTIONS.has(collection)) {
        errors.push(`${path}: confirmed ${collection} record requires at least one source ref`);
      } else {
        const count = confirmedWithoutSources.get(collection) ?? 0;
        confirmedWithoutSources.set(collection, count + 1);
      }
    }
  }

  if (!data.date && ['works', 'episodes', 'appearances', 'literature'].includes(collection)) {
    warnings.push(`${path}: undated`);
  }
}

for (const [collection, count] of Array.from(confirmedWithoutSources.entries()).sort()) {
  warnings.push(`${collection}: ${count} confirmed records have no source refs`);
}

for (const warning of warnings) console.warn(`warn: ${warning}`);
if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`validated ${entries.length} entries (${warnings.length} warnings)`);
}
