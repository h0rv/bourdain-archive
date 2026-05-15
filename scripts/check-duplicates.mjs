#!/usr/bin/env node
/**
 * Finds likely duplicate content entries.
 *
 * Exact duplicate signatures fail by default. Fuzzy candidates are reported by
 * default and can fail CI with DUPLICATE_STRICT=1.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const CONTENT_ROOT = process.env.CONTENT_DIR ?? 'src/content';
const STRICT_FUZZY = process.env.DUPLICATE_STRICT === '1';
const CANDIDATE_LIMIT = Number.parseInt(process.env.DUPLICATE_LIMIT ?? '80', 10);
const HIGH_SIMILARITY = Number.parseFloat(process.env.DUPLICATE_HIGH_SIMILARITY ?? '0.94');
const REPORT_SIMILARITY = Number.parseFloat(process.env.DUPLICATE_REPORT_SIMILARITY ?? '0.88');
const EXACT_COLLECTIONS = new Set(['works', 'episodes', 'screen', 'appearances', 'literature', 'events', 'places', 'people']);

const errors = [];
const warnings = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(child));
    if (entry.isFile()) files.push(child);
  }
  return files;
}

async function loadContentFile(filePath) {
  const text = await readFile(filePath, 'utf8');
  const data = filePath.endsWith('.json') ? JSON.parse(text) : YAML.parse(text);
  const collection = path.relative(CONTENT_ROOT, path.dirname(filePath)).split(path.sep)[0];
  return {
    filePath,
    collection,
    id: data.id ?? path.basename(filePath, path.extname(filePath)),
    title: data.title ?? data.name ?? '',
    type: data.type ?? '',
    date: data.date ?? '',
    precision: data.date_precision ?? 'unknown',
    mediaType: data.media_type ?? '',
    url: data.url ?? '',
  };
}

function normalizeTitle(title) {
  return String(title)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\banthony\s+bourdain'?s?\b/g, 'bourdain')
    .replace(/\bthe\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function compactDate(entry) {
  const date = String(entry.date ?? '');
  if (!date) return '';
  if (entry.precision === 'year') return date.slice(0, 4);
  if (entry.precision === 'month') return date.slice(0, 7);
  return date.slice(0, 10);
}

function year(entry) {
  return String(entry.date ?? '').slice(0, 4);
}

function typeBucket(entry) {
  if (entry.mediaType) return entry.mediaType;
  if (['film', 'documentary', 'television', 'voice-role', 'acted-role', 'adaptation', 'show', 'episode', 'video'].includes(entry.type)) return 'screen';
  if (['podcast', 'interview', 'radio', 'panel'].includes(entry.type)) return 'appearance';
  if (['book', 'comic', 'article', 'essay', 'field-note', 'short-story'].includes(entry.type)) return 'written';
  return entry.type;
}

function exactSignature(entry) {
  return [normalizeTitle(entry.title), typeBucket(entry), compactDate(entry)].join('|');
}

function bigrams(value) {
  const padded = ` ${value} `;
  const grams = new Map();
  for (let index = 0; index < padded.length - 1; index += 1) {
    const gram = padded.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

function dice(left, right) {
  if (left === right) return 1;
  if (left.length < 3 || right.length < 3) return 0;

  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  let overlap = 0;
  for (const [gram, count] of leftGrams.entries()) {
    overlap += Math.min(count, rightGrams.get(gram) ?? 0);
  }
  return (2 * overlap) / ([...leftGrams.values()].reduce((sum, count) => sum + count, 0) + [...rightGrams.values()].reduce((sum, count) => sum + count, 0));
}

function datesCompatible(left, right) {
  const leftYear = year(left);
  const rightYear = year(right);
  if (!leftYear || !rightYear) return true;
  return leftYear === rightYear;
}

function comparable(left, right) {
  if (left.id === right.id && left.collection === right.collection) return false;
  if (typeBucket(left) !== typeBucket(right)) return false;
  if (!datesCompatible(left, right)) return false;
  return true;
}

function formatEntry(entry) {
  const date = compactDate(entry) || 'undated';
  return `${entry.collection}/${entry.id} (${entry.type}, ${date})`;
}

const files = (await walk(CONTENT_ROOT)).filter((file) => /\.(json|ya?ml)$/i.test(file));
const entries = (await Promise.all(files.map(loadContentFile))).filter((entry) => normalizeTitle(entry.title));
const exact = new Map();

for (const entry of entries) {
  if (!EXACT_COLLECTIONS.has(entry.collection)) continue;
  const signature = exactSignature(entry);
  if (!signature.split('|')[0]) continue;
  const matches = exact.get(signature) ?? [];
  matches.push(entry);
  exact.set(signature, matches);
}

for (const matches of exact.values()) {
  if (matches.length < 2) continue;
  errors.push(`exact duplicate signature: ${matches.map(formatEntry).join(' <-> ')}`);
}

const candidates = [];
for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
  const left = entries[leftIndex];
  const leftTitle = normalizeTitle(left.title);
  for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
    const right = entries[rightIndex];
    if (!comparable(left, right)) continue;

    const rightTitle = normalizeTitle(right.title);
    const score = dice(leftTitle, rightTitle);
    if (score >= REPORT_SIMILARITY) candidates.push({ left, right, score });
  }
}

candidates.sort((a, b) => b.score - a.score || formatEntry(a.left).localeCompare(formatEntry(b.left)));

for (const candidate of candidates.slice(0, CANDIDATE_LIMIT)) {
  const message = `possible duplicate ${candidate.score.toFixed(2)}: ${formatEntry(candidate.left)} "${candidate.left.title}" <-> ${formatEntry(candidate.right)} "${candidate.right.title}"`;
  if (candidate.score >= HIGH_SIMILARITY && STRICT_FUZZY) errors.push(message);
  else warnings.push(message);
}

if (candidates.length > CANDIDATE_LIMIT) {
  warnings.push(`suppressed ${candidates.length - CANDIDATE_LIMIT} additional possible duplicate candidates; raise DUPLICATE_LIMIT to inspect more`);
}

for (const warning of warnings) console.warn(`warn: ${warning}`);

if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exitCode = 1;
} else {
  const strictNote = STRICT_FUZZY ? 'strict fuzzy mode' : 'fuzzy report-only mode';
  console.log(`checked ${entries.length} content entries for duplicates (${candidates.length} candidates, ${strictNote})`);
}
