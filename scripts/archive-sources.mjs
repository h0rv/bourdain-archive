#!/usr/bin/env node
/**
 * Snapshot and normalize external datasets.
 *
 * Generic flow:
 * 1. Add a source to archive/sources.json.
 * 2. Run `npm run archive`.
 * 3. Raw snapshots go to archive/raw/.
 * 4. Converter output goes to archive/derived/.
 *
 * Stdlib-only; no runtime deps.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = resolve(ROOT, 'archive/sources.json');
const SNAPSHOTS = resolve(ROOT, 'archive/snapshots.json');
const USER_AGENT = 'bourdain-archive/0.1 metadata archiver';

async function writeJson(path, doc) {
  const fullPath = resolve(ROOT, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

async function loadSources() {
  return JSON.parse(await readFile(MANIFEST, 'utf8'));
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function fetchSource(source) {
  const localPath = source.raw_path ?? source.path ?? source.derived_path;
  const rawPath = localPath ? resolve(ROOT, localPath) : null;

  if (!source.url) {
    const buffer = await readFile(rawPath);
    return {
      id: source.id,
      url: null,
      path: localPath,
      fetched_at: null,
      bytes: buffer.length,
      sha256: sha256(buffer),
      local: true,
    };
  }

  const response = await fetch(source.url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${source.url} -> ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(rawPath), { recursive: true });
  await writeFile(rawPath, buffer);
  return {
    id: source.id,
    url: source.url,
    raw_path: source.raw_path,
    fetched_at: new Date().toISOString(),
    bytes: buffer.length,
    sha256: sha256(buffer),
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift() ?? [];
  return rows
    .filter((values) => values.some(Boolean))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function numberOrNull(value) {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function deriveShowsByCountry(source) {
  const raw = await readFile(resolve(ROOT, source.raw_path), 'utf8');
  const records = [];
  let currentRegion = null;

  for (const line of raw.split('\n')) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      currentRegion = heading[1];
      continue;
    }
    if (!line.startsWith('* ') || !currentRegion) continue;

    const item = line.slice(2).trim();
    if (!item.includes(' - _')) {
      records.push({ country_region: currentRegion, raw: item, parsed: false });
      continue;
    }

    const [title, rest] = item.split(' - _', 2);
    const underscoreIndex = rest.indexOf('_');
    if (underscoreIndex === -1) {
      records.push({ country_region: currentRegion, raw: item, parsed: false });
      continue;
    }

    const show = rest.slice(0, underscoreIndex).trim();
    const episodeCode = rest.slice(underscoreIndex + 1).trim();
    const match = episodeCode.match(/S(\d+)E(\d+)/);
    records.push({
      country_region: currentRegion,
      title: title.trim(),
      show,
      episode_code: episodeCode,
      season: match ? Number(match[1]) : null,
      episode: match ? Number(match[2]) : null,
      raw: item,
      parsed: Boolean(match),
    });
  }

  await writeJson(source.derived_path, {
    source: { id: source.id, url: source.canonical_url, raw_path: source.raw_path },
    records,
  });
}

async function deriveTravelPlaces(source) {
  const raw = await readFile(resolve(ROOT, source.raw_path), 'utf8');
  const records = parseCsv(raw.replace(/^\uFEFF/, '')).map((row) => ({
    date: row['Air Date'] || null,
    date_label: row.Airdate || null,
    year: numberOrNull(row.Year),
    show: row.Show || null,
    title: row.Title || null,
    season: numberOrNull(row.Season),
    episode: numberOrNull(row.Episode),
    city: row.City || null,
    state: row.State || null,
    country: row.Country || null,
    region: row.Region || null,
    latitude: numberOrNull(row.Latitude),
    longitude: numberOrNull(row.Longitude),
    source_url: row.Source || null,
    description: row.Description || null,
  }));

  await writeJson(source.derived_path, {
    source: {
      id: source.id,
      url: source.canonical_url,
      raw_path: source.raw_path,
      license: source.license,
    },
    records,
  });
}

async function deriveFilmingLocations(source) {
  const raw = await readFile(resolve(ROOT, source.raw_path), 'utf8');
  const rows = parseCsv(`country,city,region,show,season,episode,title,location\n${raw.replace(/^\uFEFF/, '')}`);
  const records = rows.map((row) => ({
    country: row.country || null,
    city: row.city || null,
    region: row.region || null,
    show: row.show || null,
    season: numberOrNull(row.season),
    episode: numberOrNull(row.episode),
    title: (row.title || '').replace(/^"+|"+$/g, '') || null,
    location: row.location || null,
  }));

  await writeJson(source.derived_path, {
    source: {
      id: source.id,
      url: source.canonical_url,
      raw_path: source.raw_path,
      notes: source.notes,
    },
    records,
  });
}

const URL_RE = /https?:\/\/[^\s)\]}>"']+/g;

function walkReddit(node, output = []) {
  if (Array.isArray(node)) {
    for (const item of node) walkReddit(item, output);
    return output;
  }
  if (!node || typeof node !== 'object') return output;

  const { kind } = node;
  const data = node.data && typeof node.data === 'object' ? node.data : {};
  if (kind === 't3' || kind === 't1') output.push({ kind, data });
  if (data.replies && typeof data.replies === 'object') walkReddit(data.replies, output);
  if (Array.isArray(data.children)) {
    for (const child of data.children) walkReddit(child, output);
  }
  return output;
}

function isExternalUrl(url) {
  const host = new URL(url).hostname.toLowerCase();
  return !(host.endsWith('reddit.com') || host.endsWith('redd.it'));
}

async function deriveRedditThread(source) {
  const payload = JSON.parse(await readFile(resolve(ROOT, source.raw_path), 'utf8'));
  const thread = { url: source.canonical_url };
  const links = [];
  const seen = new Set();

  for (const { kind, data } of walkReddit(payload)) {
    if (kind === 't3' && !thread.title) {
      Object.assign(thread, {
        title: data.title ?? null,
        author: data.author ?? null,
        created_utc: data.created_utc ?? null,
        permalink: data.permalink ? `https://www.reddit.com${data.permalink}` : null,
        score: data.score ?? null,
        num_comments: data.num_comments ?? null,
      });
    }

    const text = kind === 't3' ? data.selftext : data.body;
    if (!text) continue;
    const permalink = data.permalink ? `https://www.reddit.com${data.permalink}` : null;
    for (const match of text.matchAll(URL_RE)) {
      const url = match[0].replace(/[.,;:]+$/, '');
      if (!isExternalUrl(url)) continue;
      const key = `${permalink ?? ''}\n${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        url,
        reddit_permalink: permalink,
        reddit_kind: kind === 't3' ? 'post' : 'comment',
        author: data.author ?? null,
        created_utc: data.created_utc ?? null,
      });
    }
  }

  await writeJson(source.derived_path, {
    source: { id: source.id, url: source.canonical_url, raw_path: source.raw_path },
    thread,
    links,
  });
}

function splitMarkdownTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function extractMarkdownUrl(value) {
  const match = value.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/);
  return match ? match[1] : value;
}

function stripMarkdown(value) {
  return value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\(\[[^\]]+\]\)/g, '')
    .replace(/`/g, '')
    .trim();
}

async function parseMarkdownTable(rawPath) {
  const raw = await readFile(resolve(ROOT, rawPath), 'utf8');
  const rows = raw.split('\n').filter((line) => line.trim().startsWith('|'));
  if (rows.length < 2) return [];
  const headers = splitMarkdownTableRow(rows[0]).map((header) => header.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return rows.slice(2).map((line) => {
    const cells = splitMarkdownTableRow(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

async function deriveLiteratureTable(source) {
  const records = (await parseMarkdownTable(source.raw_path)).map((row) => ({
    bucket: stripMarkdown(row.bucket),
    title: stripMarkdown(row.title),
    publication: stripMarkdown(row.source),
    url: extractMarkdownUrl(row.url),
  }));
  await writeJson(source.derived_path, {
    source: { id: source.id, raw_path: source.raw_path, notes: source.notes },
    records,
  });
}

async function deriveSocialsTable(source) {
  const records = (await parseMarkdownTable(source.raw_path)).map((row) => ({
    type: stripMarkdown(row.type),
    title: stripMarkdown(row.account_resource),
    url: extractMarkdownUrl(row.url),
    notes: stripMarkdown(row.notes),
  }));
  await writeJson(source.derived_path, {
    source: { id: source.id, raw_path: source.raw_path, notes: source.notes },
    records,
  });
}

async function derive(source) {
  if (source.type === 'markdown_episode_country_index') await deriveShowsByCountry(source);
  if (source.type === 'csv_travel_places') await deriveTravelPlaces(source);
  if (source.type === 'reddit_thread_json') await deriveRedditThread(source);
  if (source.type === 'markdown_literature_table') await deriveLiteratureTable(source);
  if (source.type === 'markdown_socials_table') await deriveSocialsTable(source);
  if (source.type === 'csv_filming_locations') await deriveFilmingLocations(source);
}

async function main() {
  const sources = await loadSources();
  const snapshots = [];
  for (const source of sources) snapshots.push(await fetchSource(source));
  await writeFile(SNAPSHOTS, `${JSON.stringify(snapshots, null, 2)}\n`, 'utf8');
  for (const source of sources) await derive(source);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
