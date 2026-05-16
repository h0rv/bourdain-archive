#!/usr/bin/env node
/**
 * Import structured episode/place records from the local travel places dataset.
 *
 * The dataset is treated as a seed source: generated YAML remains the repo source
 * of truth after review and can be enriched with IMDb/TVDB identifiers later.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';

const INPUT = 'archive/raw/travel-places-map-data.csv';
const CONTENT_ROOT = 'src/content';

const showMap = {
  "A Cook's Tour": {
    slug: 'a-cooks-tour',
    parentId: 'a-cooks-tour-show',
    sources: ['travel-places-github', 'a-cooks-tour-tvdb'],
  },
  'No Reservations': {
    slug: 'no-reservations',
    parentId: 'no-reservations-show',
    sources: ['travel-places-github', 'no-reservations-tvdb'],
  },
  'The Layover': {
    slug: 'the-layover',
    parentId: 'the-layover-show',
    sources: ['travel-places-github', 'the-layover-tvdb'],
  },
  'Parts Unknown': {
    slug: 'parts-unknown',
    parentId: 'parts-unknown-show',
    sources: ['travel-places-github', 'parts-unknown-tvdb'],
  },
};

const existingPlaceIds = new Set();

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      value = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    if (row.some(Boolean)) rows.push(row);
  }

  return rows;
}

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function dateFromRow(row) {
  const [rawDate, , , , day, , , , , monthNumber, , , , , , , , , , year] = row;
  if (year && monthNumber && day) return `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!rawDate) return null;
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function clean(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

function validHttpUrl(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}

function placeIdFor(row) {
  const country = clean(row.Country);
  const city = clean(row.City);
  if (!country && !city) return null;

  if (city) {
    const citySlug = slugify(city);
    if (existingPlaceIds.has(citySlug)) return citySlug;
    return `${citySlug}-${slugify(country ?? 'unknown')}`;
  }

  const countrySlug = slugify(country);
  return existingPlaceIds.has(countrySlug) ? countrySlug : countrySlug;
}

function yaml(data) {
  return YAML.stringify(data, {
    lineWidth: 0,
    defaultStringType: 'QUOTE_DOUBLE',
    defaultKeyType: 'PLAIN',
    sortMapEntries: false,
  });
}

async function collectExistingPlaces(dir = join(CONTENT_ROOT, 'places')) {
  let names = [];
  try {
    names = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(names.map(async (name) => {
    const path = join(dir, name.name);
    if (name.isDirectory()) {
      await collectExistingPlaces(path);
      return;
    }
    if (!name.name.endsWith('.yaml') && !name.name.endsWith('.yml')) return;
    const text = await readFile(path, 'utf8');
    const match = text.match(/^id:\s*["']?([^"'\n]+)["']?/m);
    if (match) existingPlaceIds.add(match[1].trim());
  }));
}

await collectExistingPlaces();

const text = await readFile(INPUT, 'utf8');
const [header, ...records] = parseCsv(text);
const rows = records.map((row) => Object.fromEntries(header.map((key, index) => [key, clean(row[index])])));
const episodes = new Map();
const places = new Map();

for (const row of rows) {
  const show = showMap[row.Show];
  if (!show || !row.Season || !row.Episode || !row.Title) continue;

  const season = Number(row.Season);
  const episode = Number(row.Episode);
  const episodeCode = `s${String(season).padStart(2, '0')}e${String(episode).padStart(2, '0')}`;
  const titleSlug = slugify(row.Title);
  const id = `${show.slug}-${episodeCode}-${titleSlug}`;
  const placeId = placeIdFor(row);
  const sourceUrl = validHttpUrl(clean(row.Source));
  const date = dateFromRow([
    row['Air Date'],
    row.Airdate,
    row.City,
    row.Country,
    row.Day,
    row.Description,
    row.Episode,
    row.Latitude,
    row.Longitude,
    row.Month1,
    row.Month,
    row['Number of Records'],
    row.Order,
    row.Region,
    row.Season,
    row.Show,
    row.Source,
    row.State,
    row.Title,
    row.Year,
  ]);

  if (!episodes.has(id)) {
    episodes.set(id, {
      id,
      title: row.Title,
      kind: 'episode',
      index_mode: 'child',
      parent_id: show.parentId,
      type: 'episode',
      show: row.Show,
      season,
      episode,
      record_type: 'television',
      media_type: 'tv-video',
      relation_to_bourdain: 'featured',
      contributors: ['anthony-bourdain'],
      date,
      date_precision: date ? 'day' : 'unknown',
      summary: row.Description ?? undefined,
      tags: ['travel', 'food-media'],
      people: ['anthony-bourdain'],
      places: [],
      sources: show.sources,
      related: [],
      status: 'needs-review',
      availability: sourceUrl ? { official_url: sourceUrl } : {},
    });
  }

  const episodeRecord = episodes.get(id);
  if (placeId && !episodeRecord.places.includes(placeId)) episodeRecord.places.push(placeId);

  if (placeId && !existingPlaceIds.has(placeId) && !places.has(placeId)) {
    const city = clean(row.City);
    const country = clean(row.Country);
    const isCountry = !city;
    const countryId = slugify(country);
    if (city && country && !existingPlaceIds.has(countryId) && !places.has(countryId)) {
      places.set(countryId, {
        id: countryId,
        name: country,
        kind: 'place',
        index_mode: 'child',
        type: 'place',
        summary: 'Country associated with Bourdain travel programming.',
        tags: ['travel'],
        people: ['anthony-bourdain'],
        places: [],
        sources: ['travel-places-github'],
        status: 'needs-review',
      });
    }
    places.set(placeId, {
      id: placeId,
      name: city ? `${city}, ${country}` : country,
      kind: 'place',
      index_mode: 'child',
      type: 'place',
      summary: city ? `Travel location associated with ${row.Show}.` : `Country associated with Bourdain travel programming.`,
      tags: ['travel'],
      people: ['anthony-bourdain'],
      places: isCountry ? [] : [countryId],
      sources: ['travel-places-github'],
      status: 'needs-review',
    });
  }
}

for (const show of Object.values(showMap)) {
  await mkdir(join(CONTENT_ROOT, 'series', show.slug, 'episodes'), { recursive: true });
}
await mkdir(join(CONTENT_ROOT, 'places', 'countries'), { recursive: true });
await mkdir(join(CONTENT_ROOT, 'places', 'cities'), { recursive: true });

for (const record of episodes.values()) {
  const show = showMap[record.show];
  const episodeCode = `s${String(record.season).padStart(2, '0')}e${String(record.episode).padStart(2, '0')}`;
  const path = join(CONTENT_ROOT, 'series', show.slug, 'episodes', `${episodeCode}-${slugify(record.title)}.yaml`);
  await writeFile(path, yaml(record));
}

for (const record of places.values()) {
  const isCountry = record.places.length === 0;
  const path = join(CONTENT_ROOT, 'places', isCountry ? 'countries' : 'cities', `${record.id}.yaml`);
  await writeFile(path, yaml(record));
}

console.log(`imported ${episodes.size} episode records and ${places.size} new place records`);
